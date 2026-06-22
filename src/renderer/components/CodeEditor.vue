<template>
  <div ref="editorRef" class="cm-editor-host"></div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, shallowRef } from 'vue'
import { EditorView, keymap } from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import { basicSetup } from 'codemirror'
import { indentWithTab } from '@codemirror/commands'
import { oneDark } from '@codemirror/theme-one-dark'

const LANG_IMPORTS = {
  javascript: () => import('@codemirror/lang-javascript').then(m => m.javascript()),
  typescript: () => import('@codemirror/lang-javascript').then(m => m.javascript({ typescript: true })),
  tsx: () => import('@codemirror/lang-javascript').then(m => m.javascript({ jsx: true, typescript: true })),
  jsx: () => import('@codemirror/lang-javascript').then(m => m.javascript({ jsx: true })),
  python: () => import('@codemirror/lang-python').then(m => m.python()),
  json: () => import('@codemirror/lang-json').then(m => m.json()),
  markdown: () => import('@codemirror/lang-markdown').then(m => m.markdown()),
  html: () => import('@codemirror/lang-html').then(m => m.html()),
  css: () => import('@codemirror/lang-css').then(m => m.css()),
  sql: () => import('@codemirror/lang-sql').then(m => m.sql()),
  yaml: () => import('@codemirror/lang-yaml').then(m => m.yaml()),
  rust: () => import('@codemirror/lang-rust').then(m => m.rust()),
  cpp: () => import('@codemirror/lang-cpp').then(m => m.cpp()),
  java: () => import('@codemirror/lang-java').then(m => m.java()),
  go: () => import('@codemirror/lang-go').then(m => m.go()),
  xml: () => import('@codemirror/lang-html').then(m => m.html({ selfClosingTags: true })),
  vue: () => import('@codemirror/lang-html').then(m => m.html({ selfClosingTags: true })),
  shell: () => import('@codemirror/lang-javascript').then(m => m.javascript()),
  bash: () => import('@codemirror/lang-javascript').then(m => m.javascript()),
  sh: () => import('@codemirror/lang-javascript').then(m => m.javascript()),
  powershell: () => import('@codemirror/lang-javascript').then(m => m.javascript()),
  dockerfile: () => import('@codemirror/lang-javascript').then(m => m.javascript()),
}

const LANG_BY_EXT = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', mts: 'typescript', cts: 'typescript',
  jsx: 'jsx', tsx: 'tsx',
  py: 'python', pyw: 'python',
  json: 'json', jsonc: 'json',
  md: 'markdown', markdown: 'markdown',
  html: 'html', htm: 'html',
  css: 'css', scss: 'css', sass: 'css', less: 'css',
  sql: 'sql',
  yaml: 'yaml', yml: 'yaml',
  rs: 'rust',
  c: 'cpp', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', h: 'cpp', hpp: 'cpp',
  java: 'java',
  go: 'go',
  xml: 'xml', svg: 'xml',
  vue: 'vue',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  ps1: 'powershell',
  dockerfile: 'dockerfile',
}

const props = defineProps({
  modelValue: { type: String, default: '' },
  language: { type: String, default: '' },
  fileName: { type: String, default: '' },
  readOnly: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue', 'save', 'cancel'])

const editorRef = ref(null)
const view = shallowRef(null)
const langCompartment = new Compartment()

const detectLang = () => {
  if (props.language) {
    const lower = props.language.toLowerCase()
    if (LANG_IMPORTS[lower]) return lower
    return 'plaintext'
  }
  if (props.fileName) {
    const ext = props.fileName.split('.').pop()?.toLowerCase()
    const mapped = LANG_BY_EXT[ext]
    if (mapped && LANG_IMPORTS[mapped]) return mapped
  }
  return 'plaintext'
}

let updateFromProp = true

onMounted(async () => {
  const lang = detectLang()
  const langExt = lang !== 'plaintext' && LANG_IMPORTS[lang]
    ? await LANG_IMPORTS[lang]()
    : []

  const saveKeymap = keymap.of([
    {
      key: 'Mod-s',
      run: () => {
        emit('save')
        return true
      },
      preventDefault: true
    },
    {
      key: 'Escape',
      run: () => {
        emit('cancel')
        return true
      }
    }
  ])

  const updateListener = EditorView.updateListener.of(update => {
    if (update.docChanged) {
      const value = update.state.doc.toString()
      updateFromProp = false
      emit('update:modelValue', value)
    }
  })

  const state = EditorState.create({
    doc: props.modelValue || '',
    extensions: [
      basicSetup,
      oneDark,
      langCompartment.of(langExt),
      saveKeymap,
      updateListener,
      keymap.of([indentWithTab]),
      EditorState.readOnly.of(props.readOnly),
      EditorView.theme({
        '&': { height: '100%' },
        '.cm-scroller': { overflow: 'auto' },
        '.cm-content': { fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace", fontSize: '12px' },
        '.cm-gutters': { fontSize: '11px' }
      })
    ]
  })

  view.value = new EditorView({
    state,
    parent: editorRef.value
  })
})

onUnmounted(() => {
  view.value?.destroy()
})

watch(() => props.modelValue, (newVal) => {
  if (updateFromProp === false) {
    updateFromProp = true
    return
  }
  const current = view.value?.state.doc.toString()
  if (newVal !== current && view.value) {
    view.value.dispatch({
      changes: { from: 0, to: current?.length || 0, insert: newVal || '' }
    })
  }
})

watch(() => props.readOnly, (val) => {
  view.value?.dispatch({
    effects: EditorState.readOnly.reconfigure(val)
  })
})

watch([() => props.language, () => props.fileName], async () => {
  const lang = detectLang()
  const langExt = lang !== 'plaintext' && LANG_IMPORTS[lang]
    ? await LANG_IMPORTS[lang]()
    : []
  view.value?.dispatch({
    effects: langCompartment.reconfigure(langExt)
  })
})
</script>

<style scoped>
.cm-editor-host {
  height: 100%;
  width: 100%;
  overflow: hidden;
}
</style>
