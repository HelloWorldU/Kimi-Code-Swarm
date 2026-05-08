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
      // Dead Code: 模块内未使用变量 / import（由 tseslint 接管原生规则）
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        vars: 'all',
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
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
  {
    files: ['src/utils/logger.ts'],
    rules: {
      // logger 是唯一的 console 出口，其他文件禁止直接调用
      'no-console': 'off',
    },
  },
]
