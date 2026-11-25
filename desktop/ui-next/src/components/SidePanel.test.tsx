import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SidePanel } from './SidePanel';

const tabs = [{ id: 'files', label: '文件' }, { id: 'disabled', label: '不可用', disabledReason: '尚未启动' }, { id: 'terminal', label: '终端' }];
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('辅助面板', () => {
  it('默认 400px，不再使用 60% 宽度', () => {
    render(<div><SidePanel tabs={tabs} active="files" onSelect={() => {}}><p>内容</p></SidePanel></div>);
    expect(screen.getByRole('complementary').style.width).toBe('400px');
  });
  it('读取已有宽度，键盘调宽持久化', () => {
    localStorage.setItem('mc.sidePanelWidth', '520');
    render(<div><SidePanel tabs={tabs} active="files" onSelect={() => {}}>内容</SidePanel></div>);
    const handle = screen.getByRole('separator');
    expect(handle.getAttribute('aria-valuenow')).toBe('520');
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(localStorage.getItem('mc.sidePanelWidth')).toBe('544');
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(localStorage.getItem('mc.sidePanelWidth')).toBe('320');
  });
  it('标签箭头跳过不可用项', async () => {
    const onSelect = vi.fn();
    render(<div><SidePanel tabs={tabs} active="files" onSelect={onSelect}>内容</SidePanel></div>);
    screen.getByRole('tab', { name: '文件' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onSelect).toHaveBeenCalledWith('terminal');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '终端' }));
  });
  it('窄窗口提供返回，宽度恢复时不覆盖偏好或卸载内容', async () => {
    let resize!: () => void;
    let width = 600;
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width, height: 600, top: 0, bottom: 600, right: width, left: 0, x: 0, y: 0, toJSON: () => ({}) }));
    vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() {} });
    localStorage.setItem('mc.sidePanelWidth', '450');
    const onClose = vi.fn();
    render(<div><SidePanel tabs={tabs} active="files" onSelect={() => {}} onClose={onClose}><input aria-label="终端草稿" defaultValue="保留" /></SidePanel></div>);
    await waitFor(() => expect(screen.getByRole('button', { name: '返回聊天' })).toBeDefined());
    const input = screen.getByRole('textbox');
    expect(screen.getByRole('complementary').style.width).toBe('600px');
    expect(screen.queryByRole('separator')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '返回聊天' }));
    expect(onClose).toHaveBeenCalledOnce();
    width = 1000; act(() => resize());
    expect(screen.getByRole('complementary').style.width).toBe('450px');
    expect(screen.getByRole('textbox')).toBe(input);
    expect(localStorage.getItem('mc.sidePanelWidth')).toBe('450');
    rect.mockRestore();
  });
});
