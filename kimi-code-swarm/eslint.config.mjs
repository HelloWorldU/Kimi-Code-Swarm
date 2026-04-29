import js from '@eslint/js'
import ts from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import globals from 'globals'

export default [
  {
    ignores: ['**/*.d.ts'],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['src/**/*.{ts,vue}'],
    ignores: ['**/*.d.ts'],
    languageOptions: {
      parserOptions: {
        parser: ts.parser,
      },
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      // 关闭多词组件名检查（我们允许单词如 Sidebar）
      'vue/multi-word-component-names': 'off',
      // 禁止使用 var
      'no-var': 'error',
      // 优先使用 const
      'prefer-const': 'error',
      // 禁止 console（生产构建时）
      'no-console': 'warn',
      // 关闭过于严格的 Vue 格式规则（这些对 Harness 约束价值不大，且可用 --fix 自动处理）
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      // 属性排序保留（帮助 Agent 保持一致性）
      'vue/attributes-order': 'warn',
    },
  },
  {
    files: ['**/*.vue'],
    rules: {
      // Vue 特定规则
      'vue/require-default-prop': 'off',
      'vue/require-prop-types': 'off',
    },
  },
]
