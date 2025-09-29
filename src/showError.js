/**
 * Show a copyable error dialog to the user
 * @param {string} title - Error title
 * @param {string} message - Error message
 */
export function showError(message, error=null) {

    // if message is an error object, extract its message,
    // otherwise use it as-is
    if (typeof message === 'object' && message !== null) {
        error = message;
        message = message.message || JSON.stringify(message);
    }

    const title = "Error"

    message += '\n\n';
    // add stack trace if available
    if (error && error.stack) {
        message += error.stack + '\n';
    }

    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
    `;

    // Create modal dialog
    const modal = document.createElement('div');
    modal.style.cssText = `
        background: white;
        border-radius: 8px;
        padding: 20px;
        width: 60vw;
        max-width: 1200px;
        max-height: 400px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        font-family: Arial, sans-serif;
    `;

    // Create title
    const titleElement = document.createElement('h3');
    titleElement.textContent = title;
    titleElement.style.cssText = `
        margin: 0 0 15px 0;
        color: #d32f2f;
        font-size: 18px;
    `;

    // Create textarea for error message
    const textarea = document.createElement('textarea');
    textarea.value = message;
    textarea.readOnly = true;
    textarea.style.cssText = `
        width: 100%;
        height: 200px;
        border: 1px solid #ccc;
        border-radius: 4px;
        padding: 10px;
        font-family: monospace;
        font-size: 12px;
        resize: both;
        box-sizing: border-box;
    `;

    // Create button container
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
        display: flex;
        gap: 10px;
        justify-content: flex-end;
        margin-top: 15px;
    `;

    // Create copy button
    const copyButton = document.createElement('button');
    copyButton.textContent = 'Copy Error';
    copyButton.style.cssText = `
        background: #1976d2;
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
    `;

    copyButton.onclick = async () => {
        try {
            await navigator.clipboard.writeText(message);
            copyButton.textContent = 'Copied!';
            setTimeout(() => {
                copyButton.textContent = 'Copy Error';
            }, 2000);
        } catch (err) {
            // Fallback for older browsers
            textarea.select();
            document.execCommand('copy');
            copyButton.textContent = 'Copied!';
            setTimeout(() => {
                copyButton.textContent = 'Copy Error';
            }, 2000);
        }
    };

    // Create close button
    const closeButton = document.createElement('button');
    closeButton.textContent = 'Close';
    closeButton.style.cssText = `
        background: #757575;
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
    `;

    closeButton.onclick = () => {
        document.body.removeChild(overlay);
    };

    // Assemble the modal
    buttonContainer.appendChild(copyButton);
    buttonContainer.appendChild(closeButton);
    modal.appendChild(titleElement);
    modal.appendChild(textarea);
    modal.appendChild(buttonContainer);
    overlay.appendChild(modal);

    // Add to document
    document.body.appendChild(overlay);

    // Auto-select text for easy copying
    textarea.select();

    console.error(message);
}