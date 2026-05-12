/**
 * ESLint 自定义规则：禁止前端代码直接操作进程
 * harness/ARCHITECTURE.md 规定：kimi-code-swarm/src/ 纯前端，禁止直接操作进程
 */

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: '禁止前端代码 import child_process 或调用 spawn/exec',
      category: 'Possible Errors',
      recommended: true,
    },
    schema: [],
    messages: {
      noChildProcessImport:
        '前端代码禁止直接操作进程。进程管理是 src-tauri/（Rust 后端）的专属职责。如需 spawn 进程，通过 Tauri IPC 调用。',
      noSpawnCall:
        '前端代码禁止直接调用 {{name }}()。进程管理是 src-tauri/（Rust 后端）的专属职责。',
    },
  },

  create(context) {
    const filename = context.filename || context.getFilename()

    // 只检查 kimi-code-swarm/src/ 下的文件
    if (!filename.includes('kimi-code-swarm/src/')) {
      return {}
    }

    return {
      // 禁止 import child_process
      ImportDeclaration(node) {
        const source = node.source.value
        if (source === 'child_process' || source === 'node:child_process') {
          context.report({
            node,
            messageId: 'noChildProcessImport',
          })
        }
      },

      // 禁止调用 spawn / exec / execFile / fork
      CallExpression(node) {
        const callee = node.callee
        if (callee.type === 'Identifier') {
          const forbidden = ['spawn', 'exec', 'execFile', 'fork', 'execSync']
          if (forbidden.includes(callee.name)) {
            context.report({
              node,
              messageId: 'noSpawnCall',
              data: { name: callee.name },
            })
          }
        }

        // 禁止 child_process.spawn() 或 require('child_process').spawn()
        if (
          callee.type === 'MemberExpression' &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'child_process' &&
          callee.property.type === 'Identifier'
        ) {
          const forbidden = ['spawn', 'exec', 'execFile', 'fork', 'execSync']
          if (forbidden.includes(callee.property.name)) {
            context.report({
              node,
              messageId: 'noSpawnCall',
              data: { name: `child_process.${callee.property.name}` },
            })
          }
        }
      },
    }
  },
}
