//

'use strict';

// Native form controls styled like VS Code's, with its theme variables only
// (light and dark): what the deprecated webview-ui-toolkit gave the panels.
export const nativeControls = `
    input[type=text], select {
      background: var(--vscode-input-background); color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--vscode-dropdown-border, transparent));
      border-radius: 2px; padding: 3px 6px; font: inherit; box-sizing: border-box; min-width: 0;
    }
    select {
      background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground);
      border-color: var(--vscode-dropdown-border, transparent); padding: 2px 4px;
    }
    input[type=text]:focus, select:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
    input[type=text][readonly] { opacity: 0.85; }
    input[type=text].invalid { border-color: var(--vscode-inputValidation-errorBorder, red); }
    label.check { display: flex; align-items: center; gap: 6px; cursor: pointer; }
    input[type=checkbox] { margin: 0; accent-color: var(--vscode-button-background); }
    input[type=checkbox].readonly { pointer-events: none; }
    button.icon {
      display: inline-flex; align-items: center; justify-content: center;
      background: none; border: none; border-radius: 5px; padding: 3px; cursor: pointer;
      color: var(--vscode-icon-foreground, var(--vscode-foreground));
    }
    button.icon:hover { background: var(--vscode-toolbar-hoverBackground); }
    button.icon:focus-visible, button.primary:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
    button.icon:disabled { opacity: 0.35; cursor: default; background: none; }
    button.primary {
      display: inline-flex; align-items: center; justify-content: center; gap: 4px;
      background: var(--vscode-button-background); color: var(--vscode-button-foreground);
      border: 1px solid var(--vscode-button-border, transparent); border-radius: 2px;
      padding: 4px 11px; font: inherit; cursor: pointer;
    }
    button.primary:hover { background: var(--vscode-button-hoverBackground); }
    button.primary:active, button.primary.pressed { filter: brightness(0.85); }
`;
