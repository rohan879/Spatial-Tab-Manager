import { useState, useEffect, useRef } from 'react';
import './App.css';
import SpatialCanvas from './components/SpatialCanvas';
import CommandPalette from './components/CommandPalette';
import { initialTabs, generateLinks } from './utils.js';
import { 
  Search, MoveRight, Plus, StickyNote,
  Link, Link2Off, Trash2, Home, Crosshair, Sparkles, Network,
  Undo, Redo, Download, Upload, Wand2, Grid, List, Archive, Magnet
} from 'lucide-react';

const TABS_KEY = 'spatialTabs';
const LINKS_KEY = 'spatialLinks';
const NOTES_KEY = 'spatialNotes'; 

const WORKSPACE_COLORS = [
  '#8a42c1', '#007aff', '#28a745', '#ff9500', '#d12c2c', '#5ac8fa', '#ffcc00'
];

function getDomain(url) {
  try {
    if (url.startsWith('chrome://')) return 'chrome';
    return new URL(url).hostname;
  } catch (e) { return "localfile"; }
}

function App() {
  const [tooltip, setTooltip] = useState({ visible: false, content: '', x: 0, y: 0 });
  const [activeTabId, setActiveTabId] = useState(null);
  
  const [tabs, setTabs] = useState([]);
  const [links, setLinks] = useState([]);
  // Normalize notes on load
  const [notes, setNotes] = useState(() => {
    const savedNotes = localStorage.getItem(NOTES_KEY);
    if (savedNotes) {
      const parsed = JSON.parse(savedNotes);
      return parsed.map(n => ({ 
        ...n, 
        title: n.title || n.text, 
        isWorkspace: true, 
        collapsed: n.collapsed || false 
      }));
    }
    return [];
  });
  
  const [isLinking, setIsLinking] = useState(false);
  const [linkSourceNode, setLinkSourceNode] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDeletingLink, setIsDeletingLink] = useState(false);
  const [zoomToFitTrigger, setZoomToFitTrigger] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [newTabTitle, setNewTabTitle] = useState("");
  const [newTabDomain, setNewTabDomain] = useState("");
  const [focusNodeId, setFocusNodeId] = useState(null);
  const [linkingMessage, setLinkingMessage] = useState("Add Link");
  const [jumpTarget, setJumpTarget] = useState(null);
  const [searchMode, setSearchMode] = useState('keyword'); 
  
  const [isMagnetMode, setIsMagnetMode] = useState(false);
  const [selectedNodeIds, setSelectedNodeIds] = useState(new Set());
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);

  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);

  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const [contextMenu, setContextMenu] = useState(null);

  const sanitizeTabsForStorage = (tabsToSave) => {
    // We do NOT save thumbnails to localStorage to avoid quota limits
    return tabsToSave.map(t => {
      const { thumbnailUrl, ...rest } = t;
      return rest;
    });
  };

  const saveHistory = () => {
    const snapshot = {
      tabs: JSON.parse(JSON.stringify(sanitizeTabsForStorage(tabs))),
      notes: JSON.parse(JSON.stringify(notes)),
      links: links.map(l => ({
        source: l.source.id ?? l.source,
        target: l.target.id ?? l.target,
        type: l.type,
        label: l.label
      }))
    };
    setPast(prev => [...prev, snapshot]);
    setFuture([]); 
  };

  const handleUndo = () => {
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    const newPast = past.slice(0, past.length - 1);
    const currentSnapshot = {
      tabs: JSON.parse(JSON.stringify(sanitizeTabsForStorage(tabs))),
      notes: JSON.parse(JSON.stringify(notes)),
      links: links.map(l => ({ source: l.source.id ?? l.source, target: l.target.id ?? l.target, type: l.type, label: l.label }))
    };
    setFuture(prev => [currentSnapshot, ...prev]);
    setTabs(previous.tabs);
    setNotes(previous.notes);
    setLinks(previous.links);
    setPast(newPast);
  };

  const handleRedo = () => {
    if (future.length === 0) return;
    const next = future[0];
    const newFuture = future.slice(1);
    const currentSnapshot = {
      tabs: JSON.parse(JSON.stringify(sanitizeTabsForStorage(tabs))),
      notes: JSON.parse(JSON.stringify(notes)),
      links: links.map(l => ({ source: l.source.id ?? l.source, target: l.target.id ?? l.target, type: l.type, label: l.label }))
    };
    setPast(prev => [...prev, currentSnapshot]);
    setTabs(next.tabs);
    setNotes(next.notes);
    setLinks(next.links);
    setFuture(newFuture);
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (e.shiftKey) handleRedo(); else handleUndo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setIsPaletteOpen(prev => !prev);
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (document.activeElement.tagName !== 'INPUT') {
           if (selectedNodeIds.size > 0) handleDeleteSelected();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tabs, links, notes, past, future, selectedNodeIds]);

  // Data Loading
  useEffect(() => {
    const loadInitialData = () => {
      if (window.chrome && chrome.tabs) {
        chrome.tabs.query({}, (fetchedTabs) => {
          const savedTabs = localStorage.getItem(TABS_KEY);
          let finalTabs;
          if (savedTabs) {
            const parsedTabs = JSON.parse(savedTabs);
            const openTabIds = new Set(fetchedTabs.map(t => t.id));
            let syncedTabs = parsedTabs.filter(savedTab => openTabIds.has(savedTab.id));
            const savedTabIds = new Set(syncedTabs.map(t => t.id));
            const newTabs = fetchedTabs.filter(t => !savedTabIds.has(t.id)).map(tab => ({
                id: tab.id, title: tab.title, url: tab.url, domain: getDomain(tab.url), faviconUrl: tab.favIconUrl || `https://www.google.com/s2/favicons?domain=${getDomain(tab.url)}&sz=64`, fx: null, fy: null, thumbnailUrl: null, lastAccessed: Date.now()
              }));
            // Update URLs
            syncedTabs = syncedTabs.map(st => {
                const liveTab = fetchedTabs.find(ft => ft.id === st.id);
                return liveTab ? { ...st, url: liveTab.url } : st;
            });
            finalTabs = [...syncedTabs, ...newTabs];
          } else {
            finalTabs = fetchedTabs.map(tab => ({
              id: tab.id, title: tab.title, url: tab.url, domain: getDomain(tab.url), faviconUrl: tab.favIconUrl || `https://www.google.com/s2/favicons?domain=${getDomain(tab.url)}&sz=64`, fx: null, fy: null, thumbnailUrl: null, lastAccessed: Date.now()
            }));
          }
          setTabs(finalTabs);
          
          const savedLinks = localStorage.getItem(LINKS_KEY);
          if (savedLinks) {
            const parsedLinks = JSON.parse(savedLinks);
            setLinks(parsedLinks.map(link => ({
              source: finalTabs.find(tab => tab.id === link.source),
              target: finalTabs.find(tab => tab.id === link.target),
              type: link.type || 'domain',
              label: link.label
            })).filter(l => l.source && l.target));
          } else { setLinks(generateLinks(finalTabs)); }
        });
      } else {
        const savedTabs = localStorage.getItem(TABS_KEY);
        setTabs(savedTabs ? JSON.parse(savedTabs) : initialTabs);
        const savedLinks = localStorage.getItem(LINKS_KEY);
        if (savedLinks) {
          const parsedLinks = JSON.parse(savedLinks);
          const loadedTabs = savedTabs ? JSON.parse(savedTabs) : initialTabs;
          setLinks(parsedLinks.map(link => ({
            source: loadedTabs.find(tab => tab.id === link.source),
            target: loadedTabs.find(tab => tab.id === link.target),
            type: link.type || 'domain',
            label: link.label
          })).filter(l => l.source && l.target));
        } else { setLinks(generateLinks(initialTabs)); }
      }
    };
    loadInitialData();
  }, []); 

  // --- Browser Listeners & Screenshot Logic ---
  useEffect(() => {
    if (!window.chrome || !chrome.tabs) return;

    const captureThumbnail = (tabId) => {
      // Small delay to ensure render
      setTimeout(() => {
        // Capture visible tab in current window
        chrome.tabs.captureVisibleTab(null, {format: 'jpeg', quality: 20}, (dataUrl) => {
          if (chrome.runtime.lastError) {
             // Squelch expected errors if tab isn't active
             console.log("Capture failed (expected if tab hidden):", chrome.runtime.lastError.message);
             return;
          }
          if (dataUrl) {
            setTabs(prev => prev.map(t => t.id === tabId ? { ...t, thumbnailUrl: dataUrl } : t));
          }
        });
      }, 800);
    };

    const onCreatedListener = (tab) => {
      const newTabNode = {
        id: tab.id, title: tab.title || "New Tab", url: tab.url, domain: getDomain(tab.url), faviconUrl: tab.favIconUrl || `https://www.google.com/s2/favicons?domain=${getDomain(tab.url)}&sz=64`, fx: null, fy: null, thumbnailUrl: null, lastAccessed: Date.now()
      };
      setTabs(prev => [...prev, newTabNode]);
      if (tab.openerTabId) {
          setLinks(prev => [...prev, { source: tab.openerTabId, target: tab.id, type: 'history' }]);
      }
    };
    const onRemovedListener = (tabId) => {
      setTabs(prev => prev.filter(tab => tab.id !== tabId));
      setNotes(prev => prev.filter(note => note.id !== tabId)); 
      setLinks(prev => prev.filter(l => (l.source.id ?? l.source) !== tabId && (l.target.id ?? l.target) !== tabId));
    };
    const onUpdatedListener = (tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete' && tab.active) {
        captureThumbnail(tabId);
      }
      if (changeInfo.url || changeInfo.title || changeInfo.favIconUrl) {
        setTabs(prev => prev.map(t => {
          if (t.id === tabId) {
            return { 
                ...t, 
                title: tab.title, 
                url: tab.url,
                domain: getDomain(tab.url), 
                faviconUrl: tab.favIconUrl || `https://www.google.com/s2/favicons?domain=${getDomain(tab.url)}&sz=64`, 
                lastAccessed: Date.now() 
            };
          }
          return t;
        }));
      }
    };
    const onActivatedListener = (activeInfo) => {
      // Capture the newly activated tab
      captureThumbnail(activeInfo.tabId);
      setTabs(prev => prev.map(t => {
         if (t.id === activeInfo.tabId) return { ...t, lastAccessed: Date.now() };
         return t;
      }));
    };

    chrome.tabs.onCreated.addListener(onCreatedListener);
    chrome.tabs.onRemoved.addListener(onRemovedListener);
    chrome.tabs.onUpdated.addListener(onUpdatedListener);
    chrome.tabs.onActivated.addListener(onActivatedListener);
    return () => {
      chrome.tabs.onCreated.removeListener(onCreatedListener);
      chrome.tabs.onRemoved.removeListener(onRemovedListener);
      chrome.tabs.onUpdated.removeListener(onUpdatedListener);
      chrome.tabs.onActivated.removeListener(onActivatedListener);
    };
  }, []);

  // Saving
  useEffect(() => {
    if (tabs.length > 0) localStorage.setItem(TABS_KEY, JSON.stringify(sanitizeTabsForStorage(tabs)));
  }, [tabs]);
  useEffect(() => {
    if (links.length > 0) {
      const savableLinks = links.map(link => ({ source: link.source.id ?? link.source, target: link.target.id ?? link.target, type: link.type, label: link.label }));
      localStorage.setItem(LINKS_KEY, JSON.stringify(savableLinks));
    }
  }, [links]);
  useEffect(() => { localStorage.setItem(NOTES_KEY, JSON.stringify(notes)); }, [notes]);

  const getViewportCenter = () => {
    if (canvasRef.current) return canvasRef.current.getViewportCenter();
    return { x: 300, y: 300 };
  };

  // Handlers
  const toggleLinkMode = () => {
    setIsLinking(!isLinking);
    setIsDeleting(false); setIsDeletingLink(false); setLinkSourceNode(null); setFocusNodeId(null); setIsMagnetMode(false);
    if (!isLinking) setLinkingMessage("Click source node...");
    else setLinkingMessage("Add Link");
  };
  const toggleDeleteMode = () => {
    setIsDeleting(!isDeleting);
    setIsLinking(false); setIsDeletingLink(false); setFocusNodeId(null); setLinkSourceNode(null); setLinkingMessage("Add Link"); setIsMagnetMode(false);
  };
  const toggleDeleteLinkMode = () => {
    setIsDeletingLink(!isDeletingLink);
    setIsLinking(false); setIsDeleting(false); setFocusNodeId(null); setLinkSourceNode(null); setLinkingMessage("Add Link"); setIsMagnetMode(false);
  };
  
  const handleZoomToFit = () => { setFocusNodeId(null); setZoomToFitTrigger(prev => prev + 1); };

  const handleDeleteSelected = () => {
    saveHistory();
    if (selectedNodeIds.size > 0) {
      if (window.chrome && chrome.tabs) {
        const tabsToRemove = [...selectedNodeIds].filter(id => tabs.some(t => t.id === id));
        if (tabsToRemove.length > 0) chrome.tabs.remove(tabsToRemove);
      }
      setTabs(prev => prev.filter(t => !selectedNodeIds.has(t.id)));
      setNotes(prev => prev.filter(n => !selectedNodeIds.has(n.id)));
      setLinks(prev => prev.filter(l => {
        const s = l.source.id ?? l.source;
        const t = l.target.id ?? l.target;
        return !selectedNodeIds.has(s) && !selectedNodeIds.has(t);
      }));
      setSelectedNodeIds(new Set());
    } else {
      toggleDeleteMode();
    }
  };
  
  const handleCreateWorkspace = () => {
    saveHistory();
    const { x, y } = getViewportCenter();
    const newNote = {
      id: Date.now(), title: "New Workspace", isWorkspace: true,
      color: WORKSPACE_COLORS[notes.length % WORKSPACE_COLORS.length], fx: x, fy: y, collapsed: false
    };
    setNotes(prevNotes => [...prevNotes, newNote]);
    setIsLinking(true); setLinkSourceNode(newNote.id); setLinkingMessage("Click nodes to add. (Esc to finish)");
  };

  const handleAutoGroup = () => {
    saveHistory();
    const ungroupedTabs = tabs.filter(t => !links.some(l => (l.target.id ?? l.target) === t.id && l.type === 'cluster'));
    if (ungroupedTabs.length === 0) { alert("All tabs are already organized!"); return; }
    const domains = {};
    ungroupedTabs.forEach(t => { if (!domains[t.domain]) domains[t.domain] = []; domains[t.domain].push(t); });
    const newNotes = []; const newLinks = [];
    const { x, y } = getViewportCenter();
    let offset = 0;
    Object.entries(domains).forEach(([domain, groupTabs]) => {
      if (groupTabs.length > 1) { 
        const newNote = {
          id: Date.now() + offset, title: domain, isWorkspace: true,
          color: WORKSPACE_COLORS[(notes.length + offset) % WORKSPACE_COLORS.length], fx: x + (offset * 60), fy: y + (offset * 60), collapsed: false
        };
        newNotes.push(newNote);
        groupTabs.forEach(t => { newLinks.push({ source: newNote.id, target: t.id, type: 'cluster' }); });
        offset++;
      }
    });
    if (newNotes.length > 0) {
      setNotes(prev => [...prev, ...newNotes]);
      setLinks(prev => [...prev, ...newLinks]);
      setZoomToFitTrigger(prev => prev + 1); 
    } else { alert("No domain groups found."); }
  };
  
  const handleAddNewTab = () => {
    saveHistory();
    const title = newTabTitle.trim(); const domain = newTabDomain.trim();
    if (title === "" || domain === "") { alert("Please fill out both title and domain."); return; }
    if (window.chrome && chrome.tabs) {
      chrome.tabs.create({ url: `https://www.${domain}` });
    } else {
      const { x, y } = getViewportCenter();
      const newTab = { id: Date.now(), title: title, domain: domain, faviconUrl: `https://www.google.com/s2/favicons?domain=${domain}&sz=64`, fx: x, fy: y, thumbnailUrl: null, lastAccessed: Date.now() };
      setTabs(prev => [...prev, newTab]);
    }
    setNewTabTitle(""); setNewTabDomain(""); setActiveTabId(null);
  };
  const handleFocusToggle = () => { if (focusNodeId === activeTabId) setFocusNodeId(null); else setFocusNodeId(activeTabId); setZoomToFitTrigger(prev => prev + 1); };
  
  const performJump = (noteId) => {
    if (noteId) {
      const note = notes.find(n => n.id === parseInt(noteId));
      if (note) { setJumpTarget(note); }
    } else { setJumpTarget(null); }
  };
  const handleJumpToNote = (event) => { performJump(event.target.value); event.target.value = ""; };

  const handleCreateWorkspaceFromSearch = () => {
    saveHistory();
    const query = searchQuery.toLowerCase().trim();
    if (query.length === 0) { alert("Please type a search query first."); return; }
    const allGraphData = [...tabs, ...notes];
    const matchedTabs = tabs.filter(d => d.title.toLowerCase().includes(query) || d.domain.toLowerCase().includes(query));
    const matchedNotes = notes.filter(d => (d.title || d.text).toLowerCase().includes(query));
    let finalMatchedNodes = [...matchedTabs, ...matchedNotes];
    if (searchMode === 'cluster') {
      const nodeMap = new Map(allGraphData.map(node => [node.id, node]));
      const hydratedLinks = links.map(link => ({
        source: nodeMap.get(link.source.id ?? link.source),
        target: nodeMap.get(link.target.id ?? link.target),
        type: link.type
      })).filter(l => l.source && l.target);
      const matchedNodeIds = new Set(finalMatchedNodes.map(n => n.id));
      const queue = [...finalMatchedNodes.map(n => n.id)];
      while (queue.length > 0) {
        const currentId = queue.pop();
        hydratedLinks.forEach(link => {
          let neighborId = null;
          if (link.source.id === currentId && !matchedNodeIds.has(link.target.id)) neighborId = link.target.id;
          else if (link.target.id === currentId && !matchedNodeIds.has(link.source.id)) neighborId = link.source.id;
          if (neighborId) { matchedNodeIds.add(neighborId); queue.push(neighborId); }
        });
      }
      finalMatchedNodes = allGraphData.filter(n => matchedNodeIds.has(n.id));
    }
    if (finalMatchedNodes.length === 0) { alert("No nodes found for that query."); return; }
    const { x, y } = getViewportCenter();
    const newNote = {
      id: Date.now(), title: `Workspace: ${searchQuery}`, isWorkspace: true, color: WORKSPACE_COLORS[notes.length % WORKSPACE_COLORS.length], fx: x, fy: y, collapsed: false
    };
    const newClusterLinks = finalMatchedNodes.map(node => ({ source: newNote.id, target: node.id, type: 'cluster' }));
    setNotes(prevNotes => [...prevNotes, newNote]);
    setLinks(prevLinks => [...prevLinks, ...newClusterLinks]);
    setSearchQuery(""); setFocusNodeId(newNote.id); setZoomToFitTrigger(prev => prev + 1);
  };
  const toggleSearchMode = () => { setSearchMode(prev => (prev === 'keyword' ? 'cluster' : 'keyword')); };
  
  const handleExportSession = () => {
    const data = { tabs: sanitizeTabsForStorage(tabs), notes, links: links.map(l => ({ source: l.source.id ?? l.source, target: l.target.id ?? l.target, type: l.type, label: l.label })) };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `spatial-session-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };
  const handleImportClick = () => { fileInputRef.current.click(); };
  const handleImportSession = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.tabs && data.notes && data.links) {
          saveHistory();
          setTabs(data.tabs); setNotes(data.notes); setLinks(data.links);
          alert("Session loaded successfully!");
        } else { alert("Invalid session file."); }
      } catch (err) { alert("Error parsing file."); }
    };
    reader.readAsText(file);
    event.target.value = null; 
  };
  const handleNodeContextMenu = (event, nodeData) => { event.preventDefault(); setContextMenu({ x: event.clientX, y: event.clientY, node: nodeData }); };
  const handleCloseContextMenu = () => { setContextMenu(null); };
  const cmActionRename = () => {
    const newName = prompt("Enter new name:", contextMenu.node.title);
    if (newName) { saveHistory(); setNotes(prev => prev.map(n => n.id === contextMenu.node.id ? {...n, title: newName} : n)); }
    handleCloseContextMenu();
  };
  const cmActionDelete = () => {
    saveHistory();
    if (contextMenu.node.isWorkspace) { setNotes(prev => prev.filter(n => n.id !== contextMenu.node.id)); } 
    else {
      if (window.chrome && chrome.tabs) chrome.tabs.remove(contextMenu.node.id);
      else setTabs(prev => prev.filter(t => t.id !== contextMenu.node.id));
    }
    setLinks(prev => prev.filter(l => (l.source.id ?? l.source) !== contextMenu.node.id && (l.target.id ?? l.target) !== contextMenu.node.id));
    handleCloseContextMenu();
  };
  const cmActionCloseWorkspaceTabs = () => {
    saveHistory();
    const workspaceId = contextMenu.node.id;
    const linkedTabIds = links.filter(l => {
          const s = l.source.id ?? l.source; const t = l.target.id ?? l.target;
          return (s === workspaceId || t === workspaceId) && l.type === 'cluster';
      }).map(l => { const s = l.source.id ?? l.source; const t = l.target.id ?? l.target; return s === workspaceId ? t : s; });
    if (window.chrome && chrome.tabs && linkedTabIds.length > 0) chrome.tabs.remove(linkedTabIds);
    if (!window.chrome || !chrome.tabs) setTabs(prev => prev.filter(t => !linkedTabIds.includes(t.id)));
    setNotes(prev => prev.filter(n => n.id !== workspaceId));
    setLinks(prev => prev.filter(l => {
        const s = l.source.id ?? l.source; const t = l.target.id ?? l.target;
        const isLinkedTab = linkedTabIds.includes(s) || linkedTabIds.includes(t);
        const isWorkspace = s === workspaceId || t === workspaceId;
        return !isLinkedTab && !isWorkspace;
    }));
    handleCloseContextMenu();
  };
  const cmActionStash = async () => {
    saveHistory();
    const workspaceId = contextMenu.node.id;
    const workspaceName = contextMenu.node.title || "Untitled";
    const linkedTabIds = links.filter(l => {
          const s = l.source.id ?? l.source; const t = l.target.id ?? l.target;
          return (s === workspaceId || t === workspaceId) && l.type === 'cluster';
      }).map(l => { const s = l.source.id ?? l.source; const t = l.target.id ?? l.target; return s === workspaceId ? t : s; });
    const tabsToStash = tabs.filter(t => linkedTabIds.includes(t.id));
    if (window.chrome && chrome.bookmarks) {
        try {
            const dateStr = new Date().toLocaleString();
            const folderTitle = `Stashed: ${workspaceName} (${dateStr})`;
            const folder = await chrome.bookmarks.create({ title: folderTitle });
            for (const tab of tabsToStash) {
                const url = tab.url || `https://${tab.domain}`;
                await chrome.bookmarks.create({ parentId: folder.id, title: tab.title, url: url });
            }
            alert(`Workspace stashed.`);
            cmActionCloseWorkspaceTabs();
        } catch (error) { alert("Failed to stash."); }
    } else { alert("Bookmark permission not available."); }
    handleCloseContextMenu();
  };
  const cmActionFocus = () => { setFocusNodeId(contextMenu.node.id); setZoomToFitTrigger(prev => prev + 1); handleCloseContextMenu(); };
  const cmActionCreateWorkspace = () => {
    saveHistory();
    const { x, y } = getViewportCenter();
    const newNote = {
      id: Date.now(), title: `Workspace: ${contextMenu.node.domain}`, isWorkspace: true,
      color: WORKSPACE_COLORS[notes.length % WORKSPACE_COLORS.length], fx: x, fy: y, collapsed: false
    };
    const newLink = { source: newNote.id, target: contextMenu.node.id, type: 'cluster' };
    setNotes(prev => [...prev, newNote]); setLinks(prev => [...prev, newLink]);
    setFocusNodeId(newNote.id); setZoomToFitTrigger(prev => prev + 1);
    handleCloseContextMenu();
  };
  const handleTidy = (layoutType) => {
    if (!contextMenu || !contextMenu.node.isWorkspace) return;
    saveHistory();
    const workspaceId = contextMenu.node.id;
    const workspaceNode = notes.find(n => n.id === workspaceId);
    const connectedLinkData = links.filter(l => {
      const s = l.source.id ?? l.source; const t = l.target.id ?? l.target;
      return (s === workspaceId || t === workspaceId) && l.type === 'cluster';
    });
    const connectedTabIds = connectedLinkData.map(l => { const s = l.source.id ?? l.source; const t = l.target.id ?? l.target; return s === workspaceId ? t : s; });
    const tabsToTidy = tabs.filter(t => connectedTabIds.includes(t.id));
    const count = tabsToTidy.length;
    if (count === 0) { handleCloseContextMenu(); return; }
    const startX = workspaceNode.fx ?? workspaceNode.x;
    const startY = (workspaceNode.fy ?? workspaceNode.y) + 60; 
    let newTabsState = [...tabs];
    if (layoutType === 'grid') {
      const cols = Math.ceil(Math.sqrt(count));
      const spacing = 80;
      tabsToTidy.forEach((tab, index) => {
        const row = Math.floor(index / cols);
        const col = index % cols;
        const newX = startX + (col - (cols-1)/2) * spacing;
        const newY = startY + row * spacing;
        const tabIndex = newTabsState.findIndex(t => t.id === tab.id);
        if (tabIndex !== -1) { newTabsState[tabIndex] = { ...newTabsState[tabIndex], fx: newX, fy: newY, x: newX, y: newY }; }
      });
    } else if (layoutType === 'list') {
      const spacing = 50;
      tabsToTidy.forEach((tab, index) => {
        const newX = startX;
        const newY = startY + index * spacing;
        const tabIndex = newTabsState.findIndex(t => t.id === tab.id);
        if (tabIndex !== -1) { newTabsState[tabIndex] = { ...newTabsState[tabIndex], fx: newX, fy: newY, x: newX, y: newY }; }
      });
    }
    setTabs(newTabsState);
    handleCloseContextMenu();
  };
  const handleLinkRename = (link) => {
    const currentLabel = link.label || "";
    const newLabel = prompt("Enter label for link:", currentLabel);
    if (newLabel !== null) {
      saveHistory();
      setLinks(prev => prev.map(l => {
        const s = l.source.id ?? l.source; const t = l.target.id ?? l.target;
        const targetS = link.source.id ?? link.source; const targetT = link.target.id ?? link.target;
        if (s === targetS && t === targetT) return { ...l, label: newLabel };
        return l;
      }));
    }
  };

  const commandActions = [
    { label: "Create Workspace", action: handleCreateWorkspace },
    { label: "Zoom to Fit", action: handleZoomToFit },
    { label: "Toggle Link Mode", action: toggleLinkMode },
    { label: "Toggle Delete Mode", action: toggleDeleteMode },
    { label: "Undo", action: handleUndo },
    { label: "Redo", action: handleRedo },
    { label: "Auto-Group by Domain", action: handleAutoGroup },
  ];
  const workspacesForPalette = notes.map(n => ({ ...n, onJump: performJump }));

  return (
    <div className="app-root" onClick={handleCloseContextMenu}>
      <CommandPalette isOpen={isPaletteOpen} onClose={() => setIsPaletteOpen(false)} actions={commandActions} workspaces={workspacesForPalette} />
      <header className="header">
        <div className="search-wrapper">
          <button onClick={toggleSearchMode} className="search-mode-toggle" title={`Search Mode: ${searchMode === 'keyword' ? 'Keyword' : 'Cluster'}`}>
            {searchMode === 'keyword' ? <Search size={18} className="search-icon" /> : <Network size={18} className="search-icon" />}
          </button>
          <input type="text" className="search-bar" placeholder={searchMode === 'keyword' ? 'Search keywords...' : 'Search clusters...'} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          <button className="search-action-button" title="Create Workspace from Search" onClick={handleCreateWorkspaceFromSearch} disabled={searchQuery.length === 0}>
            <Sparkles size={16} />
          </button>
        </div>
        
        {notes.length > 0 && (
          <div className="jumper-wrapper">
            <MoveRight size={18} className="search-icon" />
            <select className="workspace-jumper" onChange={handleJumpToNote} value="">
              <option value="">Jump to Workspace...</option>
              {notes.map(note => (
                <option key={note.id} value={note.id}>
                  {(note.title || note.text || "Untitled").replace(/<[^>]*>?/gm, '').substring(0, 20)}...
                </option>
              ))}
            </select>
          </div>
        )}
        
        <div className="button-controls">
           <button onClick={handleAutoGroup} className="toolbar-button" title="Auto-Group by Domain"><Wand2 size={18} /></button>
           <button onClick={handleUndo} className="toolbar-button" title="Undo (Ctrl+Z)" disabled={past.length === 0}><Undo size={18} /></button>
           <button onClick={handleRedo} className="toolbar-button" title="Redo (Ctrl+Shift+Z)" disabled={future.length === 0}><Redo size={18} /></button>
           <button onClick={handleExportSession} className="toolbar-button" title="Save Session to File"><Download size={18} /></button>
           <button onClick={handleImportClick} className="toolbar-button" title="Load Session from File"><Upload size={18} /></button>
           <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept=".json" onChange={handleImportSession} />
        </div>

        <div className="add-tab-form">
          <input type="text" placeholder="New Tab Title..." value={newTabTitle} onChange={(e) => setNewTabTitle(e.target.value)} />
          <input type="text" placeholder="New Tab Domain..." value={newTabDomain} onChange={(e) => setNewTabDomain(e.target.value)} />
          <button onClick={handleAddNewTab} className="add-tab-button"><Plus size={16} /> {activeTabId ? 'Add Child' : 'Add Tab'}
          </button>
        </div>
        <div className="button-controls"> 
          <button onClick={handleCreateWorkspace} className="create-workspace-button" title="Create New Workspace"><StickyNote size={18} /></button>
        </div>
      </header>

      <div className="side-toolbar">
        {activeTabId && (
          <button onClick={handleFocusToggle} className={`toolbar-button ${focusNodeId === activeTabId ? 'active' : ''}`} title={focusNodeId === activeTabId ? 'Unfocus Cluster (Esc)' : 'Focus Cluster'}><Crosshair size={20} /></button>
        )}
        <button onClick={handleZoomToFit} className="toolbar-button" title="Zoom to Fit"><Home size={20} /></button>
        <button onClick={toggleLinkMode} className={`toolbar-button ${isLinking ? 'active' : ''}`} title={linkingMessage}><Link size={20} /></button>
        <button onClick={toggleDeleteLinkMode} className={`toolbar-button ${isDeletingLink ? 'active' : ''}`} title="Delete Link"><Link2Off size={20} /></button>
        <button onClick={() => setIsMagnetMode(!isMagnetMode)} className={`toolbar-button ${isMagnetMode ? 'magnet-active' : ''}`} title={isMagnetMode ? "Magnet Mode ON" : "Magnet Mode OFF"}><Magnet size={20} /></button>
        <button onClick={handleDeleteSelected} className={`toolbar-button ${isDeleting ? 'active' : ''}`} title={selectedNodeIds.size > 0 ? `Delete ${selectedNodeIds.size} Selected` : "Delete Mode"}><Trash2 size={20} color={selectedNodeIds.size > 0 ? '#ff6b6b' : 'currentColor'} /></button>
      </div>

      <main className="canvas-container">
        <SpatialCanvas
          ref={canvasRef}
          allNodes={[...tabs, ...notes]}
          setTabs={setTabs} setNotes={setNotes} links={links} setLinks={setLinks}
          isLinking={isLinking} setIsLinking={setIsLinking}
          linkSourceNode={linkSourceNode} setLinkSourceNode={setLinkSourceNode}
          setLinkingMessage={setLinkingMessage}
          isDeleting={isDeleting} setIsDeleting={setIsDeleting}
          isDeletingLink={isDeletingLink} setIsDeletingLink={setIsDeletingLink}
          setTooltip={setTooltip} activeTabId={activeTabId} setActiveTabId={setActiveTabId}
          zoomToFitTrigger={zoomToFitTrigger} searchQuery={searchQuery} searchMode={searchMode}
          focusNodeId={focusNodeId} jumpTarget={jumpTarget}
          saveHistory={saveHistory} onNodeContextMenu={handleNodeContextMenu}
          selectedNodeIds={selectedNodeIds} setSelectedNodeIds={setSelectedNodeIds}
          isMagnetMode={isMagnetMode} onLinkRename={handleLinkRename}
        />
      </main>

      {contextMenu && (
        <div className="context-menu" style={{ top: contextMenu.y, left: contextMenu.x }} onClick={(e) => e.stopPropagation()}>
          {contextMenu.node.isWorkspace && (
             <>
               <button className="context-menu-item" onClick={cmActionRename}>Rename Workspace</button>
               <button className="context-menu-item" onClick={cmActionStash}><Archive size={14} style={{marginRight: 6}}/> Stash to Bookmarks</button>
               <button className="context-menu-item" onClick={() => handleTidy('grid')}><Grid size={14} style={{marginRight: 6}}/> Tidy: Grid</button>
               <button className="context-menu-item" onClick={() => handleTidy('list')}><List size={14} style={{marginRight: 6}}/> Tidy: List</button>
               <div style={{ borderTop: '1px solid #555', margin: '4px 0' }}></div>
               <button className="context-menu-item danger" onClick={cmActionCloseWorkspaceTabs}>Close Workspace & Tabs</button>
             </>
          )}
          {!contextMenu.node.isWorkspace && (
             <button className="context-menu-item" onClick={cmActionCreateWorkspace}>Create Workspace Here</button>
          )}
          <button className="context-menu-item" onClick={cmActionFocus}>Focus Cluster</button>
          <div style={{ borderTop: '1px solid #555', margin: '4px 0' }}></div>
          <button className="context-menu-item danger" onClick={cmActionDelete}>{contextMenu.node.isWorkspace ? "Delete Node Only" : "Close Tab"}</button>
        </div>
      )}
      {tooltip.visible && <div className="tooltip" style={{ left: tooltip.x+15, top: tooltip.y+10 }} dangerouslySetInnerHTML={{ __html: tooltip.content }} />}
    </div>
  );
}

export default App;