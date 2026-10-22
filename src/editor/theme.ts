import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

/** Editor chrome built from the shared design tokens, so it follows the app theme. */
const chrome = EditorView.theme(
  {
    '&': {
      color: 'var(--text)',
      backgroundColor: 'var(--bg)',
      fontSize: 'var(--editor-font-size, 12.5px)'
    },
    '.cm-scroller': {
      fontFamily: 'var(--font-mono)',
      lineHeight: '1.6'
    },
    '.cm-content': {
      caretColor: 'var(--accent-hover)',
      padding: '6px 0 40vh'
    },
    // Room on the left so lanes for top-level blocks have somewhere to sit.
    '.cm-line': {
      padding: '0 8px 0 16px'
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--accent-hover)',
      borderLeftWidth: '2px'
    },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection':
      {
        backgroundColor: 'rgba(110, 121, 214, 0.28) !important'
      },
    '.cm-activeLine': {
      backgroundColor: 'rgba(255, 255, 255, 0.025)'
    },
    '.cm-gutters': {
      backgroundColor: 'var(--bg)',
      color: '#45474d',
      border: 'none',
      paddingLeft: '4px'
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent',
      color: 'var(--text)'
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 4px 0 8px',
      minWidth: '32px'
    },
    '.cm-foldGutter .cm-gutterElement': {
      color: 'var(--text-faint)',
      padding: '0 4px'
    },
    '.cm-foldPlaceholder': {
      backgroundColor: 'var(--surface-3)',
      border: 'none',
      color: 'var(--text-dim)',
      padding: '0 6px',
      borderRadius: '4px'
    },
    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
      backgroundColor: 'var(--accent-dim)',
      outline: '1px solid var(--accent-line)',
      borderRadius: '2px',
      color: 'inherit'
    },
    '.cm-nonmatchingBracket, &.cm-focused .cm-nonmatchingBracket': {
      backgroundColor: 'var(--del-dim)',
      color: 'inherit'
    },
    '.cm-selectionMatch': {
      backgroundColor: 'rgba(110, 121, 214, 0.12)'
    },
    '.cm-searchMatch': {
      backgroundColor: 'var(--warn-dim)',
      outline: '1px solid rgba(242, 153, 74, 0.4)'
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'rgba(242, 153, 74, 0.3)'
    },
    '.cm-tooltip': {
      backgroundColor: 'var(--elevated)',
      border: '1px solid var(--border-strong)',
      borderRadius: 'var(--r-md)',
      boxShadow: 'var(--shadow-pop)',
      color: 'var(--text-dim)',
      overflow: 'hidden'
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul': {
      fontFamily: 'var(--font-mono)',
      maxHeight: '18em',
      padding: '3px'
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
      padding: '2px 8px',
      borderRadius: '4px',
      lineHeight: '1.6'
    },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      backgroundColor: 'var(--accent-dim)',
      color: 'var(--text)'
    },
    '.cm-completionDetail': {
      color: 'var(--text-faint)',
      fontStyle: 'normal',
      marginLeft: '1em'
    },
    '.cm-completionMatchedText': {
      textDecoration: 'none',
      color: 'var(--accent-hover)'
    },
    '.cm-completionIcon': {
      opacity: '0.6'
    },
    '.cm-tooltip-hover, .cm-lsp-documentation': {
      maxWidth: '640px',
      maxHeight: '320px',
      overflow: 'auto',
      lineHeight: '1.5'
    },
    '.cm-lsp-documentation pre, .cm-lsp-documentation code': {
      fontFamily: 'var(--font-mono)'
    },
    '.cm-panels': {
      backgroundColor: 'var(--surface)',
      color: 'var(--text-dim)'
    },
    '.cm-panels.cm-panels-top': {
      borderBottom: '1px solid var(--border)'
    },
    '.cm-panels.cm-panels-bottom': {
      borderTop: '1px solid var(--border)'
    },
    '.cm-panel input, .cm-panel button, .cm-textfield': {
      fontFamily: 'var(--font-mono)',
      fontSize: '12px'
    },
    '.cm-textfield': {
      backgroundColor: 'var(--surface-2)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-sm)',
      color: 'var(--text)',
      padding: '3px 6px'
    },
    '.cm-button': {
      backgroundImage: 'none',
      backgroundColor: 'var(--surface-2)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-sm)',
      color: 'var(--text-dim)'
    },
    '.cm-diagnostic-error': {
      borderLeftColor: 'var(--del)'
    },
    '.cm-diagnostic-warning': {
      borderLeftColor: 'var(--warn)'
    },
    '.cm-lintRange-error': {
      backgroundImage: 'none',
      textDecoration: 'underline wavy var(--del)',
      textUnderlineOffset: '3px'
    },
    '.cm-lintRange-warning': {
      backgroundImage: 'none',
      textDecoration: 'underline wavy var(--warn)',
      textUnderlineOffset: '3px'
    },
    // Notes (info and hints) stay quiet: a dotted line, not a squiggle.
    '.cm-lintRange-info, .cm-lintRange-hint': {
      backgroundImage: 'none',
      textDecoration: 'underline dotted var(--info)',
      textUnderlineOffset: '3px'
    },
    '.cm-diagnostic': {
      padding: '4px 8px 4px 10px',
      fontFamily: 'var(--font-mono)',
      fontSize: '11.5px'
    },
    '.cm-diagnostic-info': {
      borderLeftColor: 'var(--info)'
    },
    '.cm-lint-rule': {
      marginLeft: '8px',
      color: 'var(--text-faint)',
      fontSize: '10.5px'
    },
    '.cm-diagnosticAction': {
      backgroundColor: 'var(--surface-3)',
      color: 'var(--text)',
      borderRadius: 'var(--r-sm)',
      padding: '1px 8px',
      marginLeft: '8px',
      font: 'inherit'
    },
    '.cm-diagnosticSource': {
      display: 'none'
    },
    '.cm-panel.cm-panel-lint ul': {
      maxHeight: '180px',
      fontFamily: 'var(--font-mono)'
    },
    '.cm-panel.cm-panel-lint [aria-selected]': {
      backgroundColor: 'var(--accent-dim)'
    },
    '.cm-gutter-lint': {
      width: '12px'
    },
    // Code lens row above declarations, e.g. "✦ Ask Claude · + context"
    '.cm-lens': {
      fontSize: '10.5px',
      lineHeight: '16px',
      color: 'var(--text-faint)',
      paddingLeft: '16px',
      paddingTop: '3px',
      userSelect: 'none',
      whiteSpace: 'pre'
    },
    '.cm-lens-action': {
      cursor: 'pointer'
    },
    '.cm-lens-action:hover': {
      color: 'var(--accent-hover)',
      textDecoration: 'underline'
    },
    '.cm-lens-sep': {
      padding: '0 6px',
      color: 'var(--border-strong)'
    },
    '&.cm-goto-hover .cm-content': {
      cursor: 'pointer'
    }
  },
  { dark: true }
)

/**
 * One colour per kind of name, so code reads by shape: declarations keywords are
 * indigo and control flow purple, types teal, methods blue, members lavender,
 * locals near-white, literals warm. Covers the tags the Lezer grammars (TS,
 * Python, Rust…) emit and the ones richClike adds for the C-family modes.
 */
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.definitionKeyword, t.moduleKeyword], color: '#8f9bef' },
  { tag: [t.controlKeyword, t.operatorKeyword], color: '#c38be0' },
  { tag: [t.string, t.character, t.special(t.string), t.docString], color: '#86c06a' },
  { tag: [t.regexp, t.escape], color: '#d6b656' },
  { tag: [t.number, t.integer, t.float, t.bool, t.atom, t.null, t.unit], color: '#f2994a' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--text-faint)', fontStyle: 'italic' },
  { tag: [t.typeName, t.className, t.standard(t.typeName), t.typeOperator], color: '#3fb5b5' },
  { tag: [t.definition(t.typeName), t.definition(t.className)], color: '#3fb5b5', fontWeight: '600' },
  { tag: t.namespace, color: '#5f9ea8' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#4ea7fc' },
  { tag: [t.function(t.definition(t.variableName)), t.definition(t.function(t.variableName))], color: '#4ea7fc', fontWeight: '600' },
  { tag: [t.propertyName, t.attributeName], color: '#c9b3e8' },
  { tag: t.definition(t.propertyName), color: '#d7c6ef' },
  { tag: t.variableName, color: '#d4d6db' },
  { tag: t.definition(t.variableName), color: '#eeeff1' },
  { tag: [t.constant(t.variableName), t.constant(t.propertyName)], color: '#e8875f' },
  { tag: [t.standard(t.variableName), t.self], color: '#d6b656' },
  { tag: [t.macroName, t.special(t.variableName)], color: '#e0698f' },
  { tag: t.labelName, color: '#e8875f', fontStyle: 'italic' },
  { tag: [t.meta, t.annotation, t.processingInstruction], color: '#e0698f' },
  { tag: [t.tagName], color: '#e07b5a' },
  { tag: [t.operator, t.derefOperator, t.arithmeticOperator, t.logicOperator, t.compareOperator], color: '#9aa3b0' },
  { tag: [t.punctuation, t.bracket, t.separator], color: 'var(--text-dim)' },
  { tag: t.heading, color: '#eeeff1', fontWeight: '700' },
  { tag: [t.heading1, t.heading2], color: '#eeeff1', fontWeight: '700' },
  { tag: t.link, color: 'var(--accent-hover)', textDecoration: 'underline' },
  { tag: t.url, color: 'var(--accent-hover)' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.monospace, color: '#d6b656' },
  { tag: t.quote, color: 'var(--text-dim)', fontStyle: 'italic' },
  { tag: t.invalid, color: 'var(--del)' }
])

export const editorTheme = [chrome, syntaxHighlighting(highlight)]
