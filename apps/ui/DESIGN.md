---
name: Browser 2D
description: 带文字导航、边框表格与抽屉的本地验证工作区
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

# Design System: Browser 2D

## Overview

**Creative North Star: "Operational workspace"**

The approved Airtable-inspired direction organizes Chinese business labels around visible navigation, table views, and focused drawers. The reference defines layout and flow. Element Plus supplies the controls and their geometry.

Color identifies primary actions and selected navigation. Tables retain visible borders, while secondary information uses disclosures and drawers. Task scope, command uncertainty, and resource cleanup remain visible where they affect an operation.

**Key Characteristics:**

- Text and icon navigation with persistent connection status.
- Bordered Element Plus tables with views and labeled operations.
- Purple color theming with default control geometry.
- Drawers for task selection, business editing, and import.

## Colors

### Primary

Muted purple identifies primary buttons, selected navigation, focus, and selection. The primary light and dark steps map directly to the corresponding Element Plus theme variables. The lightest step supplies selected navigation backgrounds, and stronger light steps supply hover and disabled states.

### Neutral

White is the main content background. Light lavender-gray fills distinguish the sidebar and table hover states. Element Plus neutral text and border tokens retain their library roles. The frontmatter records the effective values from src/style.css and the installed Element Plus theme.

Success, warning, danger, and information states retain Element Plus semantic colors. State labels carry their meaning alongside color.

**The Color-Only Rule.** Theme Element Plus internals through color variables. Preserve default control dimensions, radii, padding, and interaction styling.

## Typography

The renderer inherits the Element Plus system font stack. Page headings use the headline role, section headings use the title role, and business content uses the body role. The sidebar wordmark uses 18px at weight 600, reducing to 14px in compact windows. Technical identifiers use 13px code text and wrap when necessary. Descriptions use a 1.6 line height and a maximum width of 70ch.

## Layout

The shell uses a sticky full-height sidebar and a flexible content column. The expanded sidebar is 190px wide, reducing to 150px at widths up to 760px. An explicit Element Plus button collapses it to 68px at every width and remembers the preference in local storage when available. CSS owns the shell grid tracks. The collapsed rail centers the 2D brand, route icons, toggle, and connection dot. Navigation links have a 44px minimum height, and settings sit at the bottom of the navigation group above the toggle and connection status.

Content padding is 26px 40px 48px. At widths up to 1000px, it becomes 24px. At widths up to 760px, it becomes 20px. Workspaces fill the content area up to 1600px. Settings use a narrower 900px workspace, with field groups up to 720px.

Toolbars wrap as groups. Search fields have a 360px maximum width. Density selectors occupy 110px. Drawer forms use two equal columns with a 20px gap and become one column at widths up to 760px. Settings fields follow the same two-column to one-column pattern. Business forms reduce from three columns to two at 1000px, then one at 760px.

Tables scroll horizontally within their own region. Fixed action columns remain accessible at the right edge. Default, small, and large density choices use the library's table size API. They do not redefine control geometry.

## Elevation & Depth

Content uses white space, muted fills, and thin dividers. Ordinary page sections do not add decorative card shadows. Drawers, popovers, confirmation dialogs, and fixed table columns retain Element Plus elevation. Navigation background transitions last 160ms with ease-out easing. Reduced-motion preference removes this custom navigation transition. Other control motion remains library-owned.

## Shapes

Controls and navigation use the Element Plus base radius. Table cells keep visible rectangular borders. The connection indicator is a small circular dot accompanied by a text label when expanded and a tooltip when collapsed. Drawers retain the library's panel shape, padding, overlay, and close control.

## Components

### Buttons and inputs

Use ElButton, ElInput, ElSelect, ElInputNumber, and other existing Element Plus controls directly. Primary actions use the primary color. Secondary actions use the default button variant. Hover, disabled, validation, and focus behavior follow the component library. The global keyboard focus outline uses the primary color with a 2px outline and a 3px offset, subject to component-specific focus styles.

### Navigation and views

Every route has an icon and a Chinese accessible label. Expanded navigation shows labels. Collapsed navigation and connection status use Element Plus tooltips on hover and keyboard focus, with trigger keys disabled so Enter activates links. Active navigation uses the lightest purple background and primary text. Views use ElRadioGroup and ElRadioButton. Field visibility uses a click popover with checkboxes. Neither field visibility nor density changes the underlying query scope.

### Tables and state

All data tables use ElTable with border, including task, device, material, history, selection, resource, import-result, and batch-result tables. Task and material state uses labeled ElTag variants. Device data status remains numeric and separate from task availability. Material card cells show a mask with at most the last four digits. The optional CVV column always shows a mask. Full secrets do not belong in table tooltips or accessible labels.

### Drawers and disclosures

Task creation uses a device selector capped at 720px. Task details, material editing, and material import are capped at 640px. Device editing is capped at 560px. Each drawer can fill the available window width. Editing and import use labeled forms, visible errors, and guarded close decisions. Runtime details, command receipts, batch results, and resource cleanup use disclosures, with unresolved results exposed when needed.

## Do's and Don'ts

- Do retain Element Plus default geometry and use color variables for control theming.
- Do use bordered ElTable for every data table.
- Do retain Chinese accessible navigation labels, keyboard focus, and labeled state feedback in both sidebar states.
- Do retain draft guards, full editing fields, and resource or command recovery controls.
- Don't replace operational controls with prototype-specific custom controls.
- Don't expose full card numbers or CVV in table content, tooltips, or accessible labels.
- Don't describe recent snapshots as a complete task archive.
- Don't add decorative card shadows or collapse navigation without the explicit sidebar toggle.
