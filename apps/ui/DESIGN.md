---
name: Browser 2D
description: 带文字导航、明文边框表格与抽屉的浏览器及卡工作区
colors:
  primary: '#7045a5'
  primary-dark-2: '#5a3784'
  primary-light-3: '#9b7dc0'
  primary-light-5: '#b8a2d2'
  primary-light-7: '#d4c7e4'
  primary-light-8: '#e2daed'
  primary-light-9: '#f1ecf6'
  surface: '#ffffff'
  fill-light: '#f6f5f8'
  fill-lighter: '#faf9fb'
  text-primary: '#303133'
  text-regular: '#606266'
  text-secondary: '#909399'
  border: '#dcdfe6'
  border-light: '#e4e7ed'
  border-lighter: '#ebeef5'
  success: '#67c23a'
  warning: '#e6a23c'
  danger: '#f56c6c'
typography:
  headline:
    fontFamily: '"Helvetica Neue", Helvetica, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "微软雅黑", Arial, sans-serif'
    fontSize: '24px'
    fontWeight: 600
    lineHeight: 1.25
  title:
    fontFamily: '"Helvetica Neue", Helvetica, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "微软雅黑", Arial, sans-serif'
    fontSize: '16px'
    fontWeight: 600
  body:
    fontFamily: '"Helvetica Neue", Helvetica, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "微软雅黑", Arial, sans-serif'
    fontSize: '14px'
    lineHeight: 1.5
rounded:
  base: '4px'
spacing:
  field: '8px'
  toolbar: '12px'
  form: '20px'
  page-compact: '20px'
  page-medium: '24px'
  page-wide: '40px'
components:
  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.surface}'
    rounded: '{rounded.base}'
    padding: '8px 15px'
    height: '32px'
  button-primary-hover:
    backgroundColor: '{colors.primary-light-3}'
  button-default:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text-regular}'
    rounded: '{rounded.base}'
    padding: '8px 15px'
    height: '32px'
  input:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text-regular}'
    rounded: '{rounded.base}'
    height: '32px'
  navigation-active:
    backgroundColor: '{colors.primary-light-9}'
    textColor: '{colors.primary}'
    rounded: '{rounded.base}'
    padding: '0 12px'
  tag-info:
    rounded: '{rounded.base}'
    padding: '0 9px'
    height: '24px'
  table:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text-regular}'
---

# Design system

## Direction

The existing Airtable-inspired operational workspace uses Chinese labels, a persistent sidebar, bordered tables, and focused drawers. Element Plus owns controls and their geometry. Purple identifies primary actions, selected navigation, and focus. Semantic state labels always accompany color.

## Tokens and typography

The frontmatter retains the established purple theme, neutral palette, spacing, and Element Plus font stack. Runtime values live in src/assets/styles/main.css. Theme Element Plus through color variables. Preserve default component height, padding, radii, and interactions. Headings use 24px and 16px roles. Body text uses 14px. Descriptions are limited to 70ch.

## Layout

The shell uses a 190px sidebar and a flexible content column. The explicit toggle collapses it to 68px. The preference is persisted through the typed desktop settings API. Route icons and connection status have accessible labels and focus-triggered tooltips in the collapsed state. Settings sits at the bottom of navigation.

Main content uses 26px 40px 48px padding, reduced to 24px at 1000px. Workspaces fill their container up to 1600px. Settings use a narrower 1000px workspace. Toolbars wrap naturally. Search fields have a 360px maximum width. Tables own their horizontal scrolling and keep action columns at the right. The page never needs a global horizontal scrollbar.

Drawers use standard Element Plus behavior, capped at 560px for Browser editing, 640px for Card editing, and 760px for import. Each can fill the available window. Forms use two columns where space permits and one column below 760px. Drawers retain default elevation and controls.

## Data and interactions

All tables use ElTable with border. Card values are plaintext in cells, overflow labels, and accessible content. Raw numbers retain interior whitespace. Card fields can be hidden with the standard checkbox popover and are all visible initially. Amount, status, and latest verification results are backend-owned.

Row actions show pending loading before the desktop request settles. Queued and recovery states remain occupied. Errors explain the problem and recovery without showing internal task identities, transport payloads, or credential references. Empty states name the primary action.

Import uses one textarea, a labeled TXT file input, the fixed eleven-column template, and a bordered report table. Partial commits and unknown response progress have distinct messages. Draft guards protect import text and editor input across drawer and route transitions.

Settings show credential configuration state, an explicit keep, replace, or clear selector, and a password input for replacement. Binding confirmation uses a standard warning dialog. Revision and token values remain hidden.

## Motion and browser affordances

Navigation background transitions last 160ms and are removed for reduced-motion preference. Other component motion remains library-owned. Focus outlines, selection, carets, and scrollbars use theme colors. Content uses white space and dividers without decorative shadows.
