// Context Menu Component for right-click functionality
// Provides a popup menu that can be shown at mouse position

export class CContextMenu {
    constructor() {
        this.menuElement = null;
        this.isVisible = false;
        this.items = [];
        
        // Create the menu element
        this.createMenuElement();
        
        // Hide menu when clicking elsewhere
        document.addEventListener('click', (e) => {
            if (!this.menuElement.contains(e.target)) {
                this.hide();
            }
        });
        
        // Hide menu on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hide();
            }
        });
    }
    
    createMenuElement() {
        this.menuElement = document.createElement('div');
        this.menuElement.className = 'context-menu';
        this.menuElement.style.cssText = `
            position: fixed;
            background: #2a2a2a;
            border: 1px solid #555;
            border-radius: 4px;
            padding: 4px 0;
            min-width: 150px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.5);
            z-index: 10000;
            display: none;
            font-family: Arial, sans-serif;
            font-size: 12px;
            color: #fff;
        `;
        
        document.body.appendChild(this.menuElement);
    }
    
    addItem(text, callback, enabled = true) {
        const item = document.createElement('div');
        item.className = 'context-menu-item';
        item.textContent = text;
        item.style.cssText = `
            padding: 6px 12px;
            cursor: ${enabled ? 'pointer' : 'default'};
            color: ${enabled ? '#fff' : '#888'};
            border-bottom: 1px solid #444;
        `;
        
        if (enabled) {
            item.addEventListener('mouseenter', () => {
                item.style.backgroundColor = '#444';
            });
            
            item.addEventListener('mouseleave', () => {
                item.style.backgroundColor = 'transparent';
            });
            
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                callback();
                this.hide();
            });
        }
        
        this.menuElement.appendChild(item);
        this.items.push({ element: item, text, callback, enabled });
        
        return item;
    }
    
    addSeparator() {
        const separator = document.createElement('div');
        separator.style.cssText = `
            height: 1px;
            background: #555;
            margin: 2px 0;
        `;
        this.menuElement.appendChild(separator);
    }
    
    show(x, y) {
        // Clear existing items
        this.clear();
        
        // Position the menu
        this.menuElement.style.left = x + 'px';
        this.menuElement.style.top = y + 'px';
        this.menuElement.style.display = 'block';
        
        // Adjust position if menu would go off screen
        const rect = this.menuElement.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        if (rect.right > viewportWidth) {
            this.menuElement.style.left = (x - rect.width) + 'px';
        }
        
        if (rect.bottom > viewportHeight) {
            this.menuElement.style.top = (y - rect.height) + 'px';
        }
        
        this.isVisible = true;
    }
    
    hide() {
        this.menuElement.style.display = 'none';
        this.isVisible = false;
        this.clear();
    }
    
    clear() {
        // Remove all menu items
        while (this.menuElement.firstChild) {
            this.menuElement.removeChild(this.menuElement.firstChild);
        }
        this.items = [];
    }
    
    dispose() {
        if (this.menuElement && this.menuElement.parentNode) {
            this.menuElement.parentNode.removeChild(this.menuElement);
        }
    }
}

// Global context menu instance
export const GlobalContextMenu = new CContextMenu();