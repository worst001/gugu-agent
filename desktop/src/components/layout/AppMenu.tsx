import { useEffect, useState } from 'react'
import { useTranslation } from '../../i18n'
import { useUIStore } from '../../stores/uiStore'
import { WindowControls } from './WindowControls'
import {
  closeCurrentTabFromAppAction,
  createSessionFromAppAction,
  focusSidebarSearchFromAppAction,
  openSettingsFromAppAction,
  openExternalFromAppAction,
  openTerminalFromAppAction,
  quitAppFromAppAction,
  stopCurrentSessionFromAppAction,
  switchActiveTabFromAppAction,
  toggleFullscreenFromAppAction,
} from '../../utils/appActions'

const OFFICIAL_SITE_URL = 'https://gugu.guxingyao.com/'
const OFFICIAL_DOWNLOAD_URL = `${OFFICIAL_SITE_URL}download`
const FEEDBACK_ISSUES_URL = 'https://gitee.com/xiyouwangluo/claude-code-gugu/issues'

type MenuId = 'file' | 'edit' | 'view' | 'help'

export function AppMenu() {
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const t = useTranslation()

  useEffect(() => {
    if (!openMenu) return
    const close = () => setOpenMenu(null)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('click', close)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [openMenu])

  return (
    <div
      data-testid="app-menu"
      className="flex h-8 flex-shrink-0 items-stretch gap-1 border-b border-[var(--color-border)]/70 bg-[var(--color-surface-container)]/92 pl-2 text-xs text-[var(--color-text-secondary)]"
    >
      <button
        type="button"
        data-testid="app-menu-sidebar-toggle"
        aria-label={sidebarOpen ? t('sidebar.collapse') : t('sidebar.expand')}
        title={sidebarOpen ? t('sidebar.collapse') : t('sidebar.expand')}
        className="mt-1 flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
        onClick={toggleSidebar}
      >
        <span className="material-symbols-outlined text-[17px]" aria-hidden="true">
          {sidebarOpen ? 'dock_to_left' : 'dock_to_right'}
        </span>
      </button>
      <MenuButton id="file" label={t('appMenu.file')} openMenu={openMenu} setOpenMenu={setOpenMenu}>
        <MenuItem icon="add" label={t('appMenu.file.newSession')} shortcut="Ctrl/Cmd+N" onSelect={() => {
          useUIStore.getState().setActiveView('code')
          void createSessionFromAppAction()
        }} />
        <MenuItem icon="close" label={t('appMenu.file.close')} shortcut="Ctrl/Cmd+W" onSelect={closeCurrentTabFromAppAction} />
        <MenuSeparator />
        <MenuItem icon="settings" label={t('appMenu.file.settings')} shortcut="Ctrl/Cmd+," onSelect={() => openSettingsFromAppAction('general')} />
        <MenuSeparator />
        <MenuItem icon="power_settings_new" label={t('appMenu.file.quit')} shortcut="Ctrl/Cmd+Q" onSelect={() => void quitAppFromAppAction()} />
      </MenuButton>

      <MenuButton id="edit" label={t('appMenu.edit')} openMenu={openMenu} setOpenMenu={setOpenMenu}>
        <MenuItem icon="undo" label={t('appMenu.edit.undo')} shortcut="Ctrl/Cmd+Z" onSelect={() => execEditCommand('undo')} />
        <MenuItem icon="redo" label={t('appMenu.edit.redo')} shortcut="Ctrl/Cmd+Y" onSelect={() => execEditCommand('redo')} />
        <MenuSeparator />
        <MenuItem icon="content_cut" label={t('appMenu.edit.cut')} shortcut="Ctrl/Cmd+X" onSelect={() => execEditCommand('cut')} />
        <MenuItem icon="content_copy" label={t('appMenu.edit.copy')} shortcut="Ctrl/Cmd+C" onSelect={() => execEditCommand('copy')} />
        <MenuItem icon="content_paste" label={t('appMenu.edit.paste')} shortcut="Ctrl/Cmd+V" onSelect={() => execEditCommand('paste')} />
        <MenuSeparator />
        <MenuItem icon="select_all" label={t('appMenu.edit.selectAll')} shortcut="Ctrl/Cmd+A" onSelect={() => execEditCommand('selectAll')} />
      </MenuButton>

      <MenuButton id="view" label={t('appMenu.view')} openMenu={openMenu} setOpenMenu={setOpenMenu}>
        <MenuItem icon="dock_to_right" label={t('appMenu.view.toggleSidebar')} shortcut="Ctrl/Cmd+B" onSelect={() => useUIStore.getState().toggleSidebar()} />
        <MenuItem icon="search" label={t('appMenu.view.search')} shortcut="Ctrl/Cmd+K" onSelect={focusSidebarSearchFromAppAction} />
        <MenuItem icon="terminal" label={t('appMenu.view.terminal')} onSelect={openTerminalFromAppAction} />
        <MenuSeparator />
        <MenuItem icon="skip_previous" label={t('appMenu.view.prevChat')} shortcut="Ctrl/Cmd+Shift+[" onSelect={() => switchActiveTabFromAppAction(-1)} />
        <MenuItem icon="skip_next" label={t('appMenu.view.nextChat')} shortcut="Ctrl/Cmd+Shift+]" onSelect={() => switchActiveTabFromAppAction(1)} />
        <MenuSeparator />
        <MenuItem icon="fullscreen" label={t('appMenu.view.fullscreen')} shortcut="F11" onSelect={() => void toggleFullscreenFromAppAction()} />
        <MenuItem icon="stop_circle" label={t('appMenu.view.stop')} shortcut="Ctrl/Cmd+." onSelect={stopCurrentSessionFromAppAction} />
      </MenuButton>

      <MenuButton id="help" label={t('appMenu.help')} openMenu={openMenu} setOpenMenu={setOpenMenu}>
        <MenuItem icon="public" label={t('appMenu.help.website')} onSelect={() => void openExternalFromAppAction(OFFICIAL_SITE_URL)} />
        <MenuItem icon="download" label={t('appMenu.help.download')} onSelect={() => void openExternalFromAppAction(OFFICIAL_DOWNLOAD_URL)} />
        <MenuItem icon="bug_report" label={t('appMenu.help.feedback')} onSelect={() => void openExternalFromAppAction(FEEDBACK_ISSUES_URL)} />
        <MenuSeparator />
        <MenuItem icon="keyboard" label={t('appMenu.help.shortcuts')} onSelect={() => openSettingsFromAppAction('general')} />
        <MenuItem icon="info" label={t('appMenu.help.about')} onSelect={() => openSettingsFromAppAction('about')} />
      </MenuButton>
      <div className="min-w-4 flex-1" data-tauri-drag-region />
      <WindowControls />
    </div>
  )
}

function MenuButton({
  id,
  label,
  openMenu,
  setOpenMenu,
  children,
}: {
  id: MenuId
  label: string
  openMenu: MenuId | null
  setOpenMenu: (id: MenuId | null) => void
  children: React.ReactNode
}) {
  const open = openMenu === id
  return (
    <div className="relative">
      <button
        type="button"
        className={`mt-1 rounded-[var(--radius-sm)] px-2 py-1 transition-colors ${open ? 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]' : 'hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'}`}
        onClick={(event) => {
          event.stopPropagation()
          setOpenMenu(open ? null : id)
        }}
      >
        {label}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-[90] mt-1 w-max min-w-[172px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-[var(--shadow-dropdown)]"
        >
          {children}
        </div>
      )}
    </div>
  )
}

function MenuItem({
  icon,
  label,
  shortcut,
  onSelect,
}: {
  icon: string
  label: string
  shortcut?: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
    >
      <span className="material-symbols-outlined text-[15px] text-[var(--color-text-tertiary)]">{icon}</span>
      <span className="flex-1">{label}</span>
      {shortcut && <span className="ml-6 text-[var(--color-text-tertiary)]">{shortcut}</span>}
    </button>
  )
}

function MenuSeparator() {
  return <div className="my-1 border-t border-[var(--color-border)]" />
}

function execEditCommand(command: string) {
  document.execCommand(command)
}
