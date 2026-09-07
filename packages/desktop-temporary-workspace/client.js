window.__ModuleLoader__.load({
  id: '@ywandy/dsh-desktop-temporary-workspace',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const {
      Button,
      IconFolderClose16,
      IconNewChatOutline16,
      IconPlusOutline16,
      Menu,
      Modal
    } = require('@deepseek-ai/dsh-client-ui-primitives')

    const NS = 'desktop.temporaryWorkspace'
    const SETTINGS_NAMESPACE = 'desktop-temporary-workspace'
    const ENSURE_PATH = '/dsh-desktop/default-workspace/ensure'
    const DEFAULT_WORKSPACE_ID = 'default'
    const ADD_WORKSPACE_ID = 'add-workspace'

    const zh = {
      defaultWorkspace: '默认执行目录',
      addWorkspace: '添加工作区…',
      operationFailed: '无法打开工作区',
      close: '关闭',
      settingsTitle: '默认执行目录',
      settingsDescription: '无需选择项目即可创建独立任务；所有默认会话共享同一目录。',
      rootDirectory: '默认执行目录',
      rootDirectoryHint: '修改只影响后续会话，不会移动或清理已有文件。',
      save: '保存',
      saving: '正在保存…',
      reset: '恢复默认值',
      required: '请输入绝对目录路径。',
      saveFailed: '设置未保存，请检查路径后重试。'
    }

    const en = {
      defaultWorkspace: 'Default workspace',
      addWorkspace: 'Add workspace…',
      operationFailed: 'Couldn’t open workspace',
      close: 'Close',
      settingsTitle: 'Default workspace',
      settingsDescription: 'Start independent tasks without choosing a project. All default sessions share one directory.',
      rootDirectory: 'Default workspace directory',
      rootDirectoryHint: 'Changes affect future sessions only and never move or remove existing files.',
      save: 'Save',
      saving: 'Saving…',
      reset: 'Restore default',
      required: 'Enter an absolute directory path.',
      saveFailed: 'The setting was not saved. Check the path and try again.'
    }

    function installStyles() {
      if (document.querySelector('style[data-plugin-css="dsh-desktop-temporary-workspace"]')) return
      const style = document.createElement('style')
      style.dataset.plugin = 'dsh-desktop-temporary-workspace'
      style.dataset.pluginCss = 'dsh-desktop-temporary-workspace'
      style.textContent = `
        .dshTemporaryWorkspaceCard{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);border-radius:14px;padding:18px;display:flex;flex-direction:column;gap:14px;color:var(--dsw-alias-label-primary)}
        .dshTemporaryWorkspaceHeader{display:flex;flex-direction:column;gap:3px}
        .dshTemporaryWorkspaceTitle{margin:0;font-size:14px;font-weight:600;line-height:22px}
        .dshTemporaryWorkspaceDescription,.dshTemporaryWorkspaceHint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
        .dshTemporaryWorkspaceField{display:flex;flex-direction:column;gap:7px}
        .dshTemporaryWorkspaceLabel{font-size:13px;font-weight:500;line-height:20px}
        .dshTemporaryWorkspaceInput{box-sizing:border-box;width:100%;height:36px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;padding:0 11px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:var(--ds-font-family-code);font-size:12px;line-height:18px;outline:none}
        .dshTemporaryWorkspaceInput:focus{border-color:var(--dsw-alias-state-business-primary)}
        .dshTemporaryWorkspaceInput:disabled{cursor:default;opacity:.58}
        .dshTemporaryWorkspaceError{margin:0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
        .dshTemporaryWorkspaceActions{display:flex;justify-content:flex-end;gap:8px}
        .dshTemporaryWorkspaceButton{height:32px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;padding:0 13px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}
        .dshTemporaryWorkspaceButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
        .dshTemporaryWorkspaceButtonPrimary{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-on-primary)}
        .dshTemporaryWorkspaceButtonPrimary:hover:not(:disabled){filter:brightness(.96)}
        .dshTemporaryWorkspaceButton:disabled{cursor:default;opacity:.45}
      `
      document.head.appendChild(style)
    }

    async function ensureDefaultWorkspace(fetchImpl = (...args) => window.fetch(...args)) {
      const response = await fetchImpl(ENSURE_PATH, {
        method: 'POST',
        headers: { accept: 'application/json' }
      })
      let payload
      try {
        payload = await response.json()
      } catch {
        payload = undefined
      }
      if (!response.ok) {
        throw new Error(
          typeof payload?.error === 'string' && payload.error !== ''
            ? payload.error
            : `Default workspace request failed with ${response.status}.`
        )
      }
      if (typeof payload?.path !== 'string' || payload.path === '') {
        throw new Error('Default workspace response did not contain a path.')
      }
      return payload.path
    }

    function buildWorkspaceMenu(workspaces, labels, busy, addAvailable) {
      return {
        items: [
          {
            id: DEFAULT_WORKSPACE_ID,
            label: labels.defaultWorkspace,
            disabled: busy
          },
          ...workspaces.map((workspace) => ({
            id: workspace.workspaceId,
            label: workspace.title,
            disabled: busy
          }))
        ],
        footer: addAvailable
          ? [{ id: ADD_WORKSPACE_ID, label: labels.addWorkspace, disabled: busy }]
          : []
      }
    }

    async function createDefaultSession(ensure, sessions) {
      const path = await ensure()
      const sessionId = await sessions.create({ cwd: path })
      sessions.open(sessionId)
      return { path, sessionId }
    }

    function DefaultWorkspacePicker({
      open,
      anchorRef,
      useWorkspaces,
      selectedId,
      onPick,
      onClose,
      createDefaultSession: startDefaultSession,
      createWorkspace,
      pickDirectory,
      t
    }) {
      const workspaceSnapshot = useWorkspaces((state) => state)
      const [busy, setBusy] = React.useState(false)
      const busyRef = React.useRef(false)
      const [error, setError] = React.useState(null)

      const labels = {
        defaultWorkspace: t('defaultWorkspace'),
        addWorkspace: t('addWorkspace')
      }
      const menu = buildWorkspaceMenu(
        workspaceSnapshot.items,
        labels,
        busy,
        typeof pickDirectory === 'function'
      )
      const items = menu.items.map((item) => ({
        ...item,
        icon: item.id === DEFAULT_WORKSPACE_ID
          ? React.createElement(IconNewChatOutline16, { size: 16 })
          : React.createElement(IconFolderClose16, { size: 16 })
      }))
      const footer = menu.footer.map((item) => ({
        ...item,
        icon: React.createElement(IconPlusOutline16, { size: 16 })
      }))
      const getAnchorRect = React.useCallback(
        () => anchorRef?.current?.getBoundingClientRect() ?? null,
        [anchorRef]
      )
      const fail = (reason) => {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
      const run = async (operation) => {
        if (busyRef.current) return
        busyRef.current = true
        setBusy(true)
        setError(null)
        onClose()
        try {
          await operation()
        } catch (reason) {
          fail(reason)
        } finally {
          busyRef.current = false
          setBusy(false)
        }
      }
      const handleSelect = (id) => {
        if (busyRef.current) return
        if (id === DEFAULT_WORKSPACE_ID) {
          void run(() => startDefaultSession())
          return
        }
        if (id === ADD_WORKSPACE_ID) {
          void run(async () => {
            const path = await pickDirectory()
            if (path === null) return
            const workspace = await createWorkspace({ path })
            onPick(workspace.workspaceId)
          })
          return
        }
        onClose()
        onPick(id)
      }

      return React.createElement(
        React.Fragment,
        null,
        React.createElement(Menu, {
          open,
          anchor: null,
          items,
          footer,
          selectedId,
          onSelect: handleSelect,
          onClose,
          portal: true,
          getAnchorRect
        }),
        React.createElement(
          Modal,
          {
            open: error !== null,
            onClose: () => setError(null),
            closeLabel: t('close'),
            title: t('operationFailed'),
            footer: React.createElement(
              Button,
              { variant: 'primary', onClick: () => setError(null) },
              t('close')
            )
          },
          error === null
            ? null
            : React.createElement(
                'div',
                { className: 'dshTemporaryWorkspaceError', role: 'alert' },
                error
              )
        )
      )
    }

    function TemporaryWorkspaceSettingsCard({ scope, t }) {
      const snapshot = React.useSyncExternalStore(
        (notify) => scope.subscribe(notify),
        () => scope.getSnapshot()
      )
      const effective = snapshot.value?.rootDirectory ?? ''
      const [draft, setDraft] = React.useState(effective)
      const [dirty, setDirty] = React.useState(false)
      const [saving, setSaving] = React.useState(false)
      const [error, setError] = React.useState(null)

      React.useEffect(() => {
        if (!dirty) setDraft(effective)
      }, [dirty, effective])

      if (snapshot.status === 'unavailable') return null

      const invalid = draft.trim() === ''
      const edit = (event) => {
        setDraft(event.target.value)
        setDirty(true)
        setError(null)
      }
      const save = async () => {
        const next = draft.trim()
        if (next === '') return
        setSaving(true)
        setError(null)
        try {
          await scope.set('rootDirectory', next)
          if (scope.getSnapshot().value?.rootDirectory !== next) {
            throw new Error(t('saveFailed'))
          }
          setDirty(false)
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason))
        } finally {
          setSaving(false)
        }
      }
      const reset = async () => {
        setSaving(true)
        setError(null)
        try {
          await scope.unset('rootDirectory')
          setDirty(false)
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason))
        } finally {
          setSaving(false)
        }
      }

      return React.createElement(
        'li',
        { className: 'dshTemporaryWorkspaceCard' },
        React.createElement(
          'header',
          { className: 'dshTemporaryWorkspaceHeader' },
          React.createElement('h3', { className: 'dshTemporaryWorkspaceTitle' }, t('settingsTitle')),
          React.createElement('p', { className: 'dshTemporaryWorkspaceDescription' }, t('settingsDescription'))
        ),
        React.createElement(
          'label',
          { className: 'dshTemporaryWorkspaceField' },
          React.createElement('span', { className: 'dshTemporaryWorkspaceLabel' }, t('rootDirectory')),
          React.createElement('input', {
            className: 'dshTemporaryWorkspaceInput',
            type: 'text',
            value: draft,
            disabled: snapshot.status !== 'ready' || !snapshot.writable || saving,
            spellCheck: false,
            onChange: edit
          }),
          React.createElement('span', { className: 'dshTemporaryWorkspaceHint' }, t('rootDirectoryHint'))
        ),
        invalid ? React.createElement('p', { className: 'dshTemporaryWorkspaceError', role: 'alert' }, t('required')) : null,
        error ? React.createElement('p', { className: 'dshTemporaryWorkspaceError', role: 'alert' }, error) : null,
        React.createElement(
          'div',
          { className: 'dshTemporaryWorkspaceActions' },
          React.createElement(
            'button',
            {
              className: 'dshTemporaryWorkspaceButton',
              type: 'button',
              disabled: snapshot.status !== 'ready' || !snapshot.writable || saving,
              onClick: () => void reset()
            },
            t('reset')
          ),
          React.createElement(
            'button',
            {
              className: 'dshTemporaryWorkspaceButton dshTemporaryWorkspaceButtonPrimary',
              type: 'button',
              disabled: snapshot.status !== 'ready' || !snapshot.writable || saving || invalid || !dirty,
              onClick: () => void save()
            },
            saving ? t('saving') : t('save')
          )
        )
      )
    }

    const inject = [
      'slots',
      'locale',
      'settingsScope',
      'sessions',
      'workspaces',
      'uiWorkspace'
    ]

    function apply(ctx) {
      installStyles()
      ctx.effect(
        () => ctx.locale.register(NS, { zh, en }),
        'dsh-desktop-temporary-workspace: dictionaries'
      )
      const t = ctx.locale.bind(NS)
      const scope = ctx.settingsScope.bind({ namespace: SETTINGS_NAMESPACE })
      const sessions = ctx.get('sessions')
      const workspaces = ctx.get('workspaces')
      const uiWorkspace = ctx.get('uiWorkspace')

      ctx.slots.inject('conversation.hero.workspace', () =>
        ctx.slots.register(
          {
            name: 'conversation.hero.workspace',
            priority: -10,
            inject: () => ({
              createDefaultSession: () =>
                createDefaultSession(() => ensureDefaultWorkspace(), sessions),
              createWorkspace: (input) => workspaces.create(input),
              pickDirectory: () => uiWorkspace.pickDirectory()
            }),
            locale: NS
          },
          DefaultWorkspacePicker
        )
      )

      ctx.slots.inject('settings.plugin.item', () =>
        ctx.slots.register(
          {
            name: 'settings.plugin.item',
            key: SETTINGS_NAMESPACE,
            locale: NS,
            inject: () => ({ scope, t })
          },
          TemporaryWorkspaceSettingsCard
        )
      )
    }

    exports.apply = apply
    exports.inject = inject
    exports.buildWorkspaceMenu = buildWorkspaceMenu
    exports.createDefaultSession = createDefaultSession
    exports.DefaultWorkspacePicker = DefaultWorkspacePicker
    exports.ensureDefaultWorkspace = ensureDefaultWorkspace
    exports.TemporaryWorkspaceSettingsCard = TemporaryWorkspaceSettingsCard
    return module.exports
  }
})
