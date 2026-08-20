window.__ModuleLoader__.load({
  id: '@ywandy/dsh-desktop-temporary-workspace',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')

    const NS = 'desktop.temporaryWorkspace'
    const SETTINGS_NAMESPACE = 'desktop-temporary-workspace'
    const ENSURE_PATH = '/dsh-desktop/default-workspace/ensure'

    const zh = {
      defaultWorkspace: '默认执行目录',
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

    const inject = ['slots', 'locale', 'settingsScope']

    function apply(ctx) {
      installStyles()
      ctx.effect(
        () => ctx.locale.register(NS, { zh, en }),
        'dsh-desktop-temporary-workspace: dictionaries'
      )
      const t = ctx.locale.bind(NS)
      const scope = ctx.settingsScope.bind({ namespace: SETTINGS_NAMESPACE })
      const source = (name) => ({
        name,
        id: 'default',
        order: 10,
        activation: 'submit',
        create: () => ensureDefaultWorkspace(),
        label: () => t('defaultWorkspace')
      })

      ctx.slots.inject(
        'conversation.hero.workspace.createSource',
        () => ctx.slots.inject('sidebar.workspaces.createSource', function* () {
          yield ctx.slots.register(
            source('conversation.hero.workspace.createSource'),
            () => null
          )
          yield ctx.slots.register(
            source('sidebar.workspaces.createSource'),
            () => null
          )
        })
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
    exports.ensureDefaultWorkspace = ensureDefaultWorkspace
    exports.TemporaryWorkspaceSettingsCard = TemporaryWorkspaceSettingsCard
    return module.exports
  }
})
