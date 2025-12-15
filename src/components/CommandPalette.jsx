import React, { useState, useEffect, useRef } from 'react';
import { Search, ArrowRight, Command } from 'lucide-react';

export default function CommandPalette({ 
  isOpen, 
  onClose, 
  workspaces, // List of notes/clusters
  actions // List of generic actions (create, zoom, etc.)
}) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);

  // Combine actions and workspaces into one searchable list
  const filteredItems = [
    // Section 1: Generic Actions
    ...actions.filter(a => a.label.toLowerCase().includes(query.toLowerCase())).map(a => ({ ...a, type: 'action' })),
    // Section 2: Workspaces
    ...workspaces.filter(w => (w.title || w.text).toLowerCase().includes(query.toLowerCase())).map(w => ({ 
      id: w.id, 
      label: `Jump to: ${w.title || w.text}`, 
      action: () => w.onJump(w.id),
      type: 'jump'
    }))
  ];

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      setQuery("");
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % filteredItems.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + filteredItems.length) % filteredItems.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredItems[selectedIndex]) {
          filteredItems[selectedIndex].action();
          onClose();
        }
      } else if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredItems, selectedIndex, onClose]);

  if (!isOpen) return null;

  return (
    <div className="cp-overlay" onClick={onClose}>
      <div className="cp-modal" onClick={e => e.stopPropagation()}>
        <div className="cp-header">
          <Search className="cp-icon" size={20} />
          <input
            ref={inputRef}
            type="text"
            className="cp-input"
            placeholder="Type a command or search..."
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <div className="cp-badge">Esc</div>
        </div>
        
        <div className="cp-list">
          {filteredItems.map((item, index) => (
            <div 
              key={index} 
              className={`cp-item ${index === selectedIndex ? 'selected' : ''}`}
              onClick={() => { item.action(); onClose(); }}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <span className="cp-item-icon">
                {item.type === 'jump' ? <ArrowRight size={14} /> : <Command size={14} />}
              </span>
              <span className="cp-item-label">{item.label}</span>
              {index === selectedIndex && <span className="cp-enter-hint">Enter</span>}
            </div>
          ))}
          {filteredItems.length === 0 && (
            <div className="cp-empty">No matching commands</div>
          )}
        </div>
      </div>
    </div>
  );
}