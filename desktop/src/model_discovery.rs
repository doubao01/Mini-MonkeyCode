use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::Duration;

use reqwest::{redirect::Policy, Url};
use serde_json::Value;
use tauri::State;
use tokio::sync::oneshot;

use crate::util::LockExt;

const MAX_BYTES: usize = 1024 * 1024;

#[derive(Default)]
pub struct ModelDiscovery(pub Mutex<HashMap<String, oneshot::Sender<()>>>);

fn models_url(base: &str) -> Result<Url, String> {
    let mut url = Url::parse(base.trim()).map_err(|_| "请输入有效的模型 API 地址")?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("模型 API 地址只支持 HTTP 或 HTTPS".into());
    }
    if url
        .as_str()
        .split('/')
        .nth(2)
        .is_some_and(|authority| authority.contains('@'))
        || url.query().is_some()
    {
        return Err("请将凭据填入 API Token，不要放在接口地址中".into());
    }
    url.set_fragment(None);
    let mut path = url.path().trim_end_matches('/').to_owned();
    for suffix in ["/chat/completions", "/responses", "/messages", "/models"] {
        if let Some(prefix) = path.strip_suffix(suffix) {
            path = prefix.to_owned();
            break;
        }
    }
    // Anthropic 官方基础地址不含 /v1；其他网关保留用户填写的基础路径。
    if path.is_empty() && url.host_str() == Some("api.anthropic.com") {
        path = "/v1".into();
    }
    url.set_path(&format!("{path}/models"));
    Ok(url)
}

fn model_ids(value: Value) -> Result<Vec<String>, String> {
    let data = value
        .get("data")
        .and_then(Value::as_array)
        .ok_or("接口未返回可识别的模型列表，请手动输入模型 ID")?;
    let mut seen = HashSet::new();
    let mut ids = Vec::new();
    for item in data {
        if let Some(id) = item.get("id").and_then(Value::as_str) {
            if !id.trim().is_empty() && id.len() <= 1024 && seen.insert(id.to_owned()) {
                ids.push(id.to_owned());
                if ids.len() == 1000 {
                    break;
                }
            }
        }
    }
    Ok(ids)
}

async fn fetch_models(
    provider: &str,
    base_url: &str,
    api_key: &str,
) -> Result<Vec<String>, String> {
    if !matches!(provider, "openai" | "openai_responses" | "anthropic") {
        return Err("此接口格式暂不支持获取模型列表，请手动输入模型 ID".into());
    }
    if api_key.trim().is_empty() {
        return Err("请填写 API Token".into());
    }
    let url = models_url(base_url)?;
    let client = reqwest::Client::builder()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| "模型请求初始化失败")?;
    let mut request = client.get(url);
    request = if provider == "anthropic" {
        request
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
    } else {
        request.bearer_auth(api_key)
    };
    // 不把 reqwest 错误或服务端正文返回给 UI，以免回显凭据和带鉴权地址。
    let mut response = request
        .send()
        .await
        .map_err(|_| "模型列表请求失败，请检查地址、凭据和网络")?;
    if !response.status().is_success() {
        return Err(format!(
            "获取模型列表失败（HTTP {}），可手动输入模型 ID",
            response.status().as_u16()
        ));
    }
    if response
        .content_length()
        .is_some_and(|n| n > MAX_BYTES as u64)
    {
        return Err("模型列表响应过大，请手动输入模型 ID".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "读取模型列表失败")? {
        if bytes.len() + chunk.len() > MAX_BYTES {
            return Err("模型列表响应过大".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value =
        serde_json::from_slice(&bytes).map_err(|_| "接口没有返回有效 JSON，请手动输入模型 ID")?;
    model_ids(value)
}

#[tauri::command]
pub async fn models_discover(
    state: State<'_, ModelDiscovery>,
    request_id: String,
    provider: String,
    base_url: String,
    api_key: String,
) -> Result<Vec<String>, String> {
    if request_id.len() > 128 || request_id.is_empty() {
        return Err("无效的请求标识".into());
    }
    let (sender, receiver) = oneshot::channel();
    {
        let mut requests = state.0.lock_ok();
        if requests.len() >= 8 || requests.contains_key(&request_id) {
            return Err("模型列表请求正在进行，请稍后重试".into());
        }
        requests.insert(request_id.clone(), sender);
    }
    let result = tokio::select! {
        result = fetch_models(&provider, &base_url, &api_key) => result,
        _ = receiver => Err("模型列表请求已取消".into()),
    };
    state.0.lock_ok().remove(&request_id);
    result
}

#[tauri::command]
pub fn models_discover_cancel(state: State<'_, ModelDiscovery>, request_id: String) {
    if let Some(sender) = state.0.lock_ok().remove(&request_id) {
        let _ = sender.send(());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn endpoint_preserves_gateway_path() {
        assert_eq!(
            models_url("https://gateway.test/v1/chat/completions")
                .unwrap()
                .as_str(),
            "https://gateway.test/v1/models"
        );
        assert_eq!(
            models_url("https://gateway.test/custom/responses")
                .unwrap()
                .as_str(),
            "https://gateway.test/custom/models"
        );
        assert_eq!(
            models_url("https://api.anthropic.com").unwrap().as_str(),
            "https://api.anthropic.com/v1/models"
        );
    }

    #[test]
    fn rejects_credentials_and_non_http() {
        for url in [
            "file:///secret",
            "https://user:password@host/v1",
            "https://host?token=secret",
        ] {
            assert!(models_url(url).is_err());
        }
    }

    #[test]
    fn ids_are_real_unique_and_bounded() {
        assert_eq!(
            model_ids(json!({"data":[{"id":"a"},{"id":"a"},{"id":"b"},{"id":""},{}]})).unwrap(),
            vec!["a", "b"]
        );
        assert!(model_ids(json!({"error":"secret"})).is_err());
    }
}
