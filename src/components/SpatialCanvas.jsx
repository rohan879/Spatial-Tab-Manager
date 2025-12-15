import React, { useRef, useEffect, forwardRef, useImperativeHandle, useState } from 'react';
import * as d3 from 'd3';
import { colorScale } from '../utils.js';

const SpatialCanvas = forwardRef(({ 
  allNodes, 
  setTabs, setNotes, 
  links, setLinks, 
  isLinking, setIsLinking, 
  linkSourceNode, setLinkSourceNode, 
  setLinkingMessage,
  isDeleting, setIsDeleting,
  isDeletingLink, setIsDeletingLink,
  setTooltip, activeTabId, setActiveTabId,
  zoomToFitTrigger,
  searchQuery,
  searchMode,
  focusNodeId,
  jumpTarget,
  saveHistory,
  onNodeContextMenu,
  selectedNodeIds,
  setSelectedNodeIds,
  onLinkRename,
  isMagnetMode
}, ref) => {
  const svgRef = useRef(null);
  const minimapRef = useRef(null); // Ref for the distinct minimap SVG
  const simulationRef = useRef(null);
  const gRef = useRef(null);
  const gHullsRef = useRef(null); 
  const gLinksRef = useRef(null);
  const gNodesRef = useRef(null);
  const zoomRef = useRef(null); 
  const gMagnetRef = useRef(null);
  
  const [currentZoomLevel, setCurrentZoomLevel] = useState(1);
  const [selectionRect, setSelectionRect] = useState(null);
  const savedViewRef = useRef(null);
  const mousePosRef = useRef({ x: 0, y: 0 });

  useImperativeHandle(ref, () => ({
    getViewportCenter: () => {
      const svg = d3.select(svgRef.current);
      const zoom = zoomRef.current;
      if (!svg || !zoom) return { x: 300, y: 300 };
      const parent = svg.node().getBoundingClientRect();
      const transform = d3.zoomTransform(svg.node());
      const x = (parent.width / 2 - transform.x) / transform.k;
      const y = (parent.height / 2 - transform.y) / transform.k;
      return { x, y };
    }
  }));

  // Track Mouse
  useEffect(() => {
    const handleMouseMove = (e) => { mousePosRef.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Lasso Logic
  useEffect(() => {
    const svg = d3.select(svgRef.current);
    const lassoDrag = d3.drag()
      .filter(event => event.shiftKey) 
      .on('start', (event) => {
        const transform = d3.zoomTransform(svg.node());
        const startX = (event.x - transform.x) / transform.k;
        const startY = (event.y - transform.y) / transform.k;
        setSelectionRect({ startX, startY, currentX: startX, currentY: startY });
      })
      .on('drag', (event) => {
        const transform = d3.zoomTransform(svg.node());
        const currX = (event.x - transform.x) / transform.k;
        const currY = (event.y - transform.y) / transform.k;
        setSelectionRect(prev => prev ? { ...prev, currentX: currX, currentY: currY } : null);
      })
      .on('end', (event) => {
        setSelectionRect(prev => {
          if (!prev) return null;
          const x1 = Math.min(prev.startX, prev.currentX);
          const x2 = Math.max(prev.startX, prev.currentX);
          const y1 = Math.min(prev.startY, prev.currentY);
          const y2 = Math.max(prev.startY, prev.currentY);
          const newSelection = new Set();
          if (gNodesRef.current) {
            gNodesRef.current.selectAll('.node-group').each(function(d) {
              const nx = d.fx ?? d.x;
              const ny = d.fy ?? d.y;
              if (nx >= x1 && nx <= x2 && ny >= y1 && ny <= y2) newSelection.add(d.id);
            });
          }
          if (setSelectedNodeIds) setSelectedNodeIds(newSelection);
          return null; 
        });
      });
    svg.call(lassoDrag);
  }, [allNodes, setSelectedNodeIds]);

  // MAIN RENDER EFFECT
  useEffect(() => {
    const svg = d3.select(svgRef.current);
    const width = svg.node().getBoundingClientRect().width;
    const height = svg.node().getBoundingClientRect().height;
    
    // --- Hull Generator ---
    const lineGenerator = d3.line()
      .x(d => d[0]).y(d => d[1])
      .curve(d3.curveBasisClosed);

    const updateClusterHulls = (currentNodes, currentLinks) => {
      if (!gHullsRef.current) return;
      const nodeMap = new Map(currentNodes.map(node => [node.id, node]));
      const adjacency = new Map();
      currentLinks.forEach(link => {
        const sId = link.source.id ?? link.source;
        const tId = link.target.id ?? link.target;
        if (!adjacency.has(sId)) adjacency.set(sId, []);
        if (!adjacency.has(tId)) adjacency.set(tId, []);
        adjacency.get(sId).push(tId);
        adjacency.get(tId).push(sId);
      });
      const workspaceNodes = currentNodes.filter(n => n.isWorkspace && !n.collapsed);
      const clusters = workspaceNodes.map(note => {
        const clusterNodes = new Set();
        const queue = [note.id]; 
        clusterNodes.add(note.id);
        while (queue.length > 0) {
          const currId = queue.pop();
          const neighbors = adjacency.get(currId) || [];
          neighbors.forEach(neighborId => {
            if (!clusterNodes.has(neighborId)) {
              clusterNodes.add(neighborId);
              queue.push(neighborId);
            }
          });
        }
        const points = [];
        clusterNodes.forEach(nodeId => {
          const node = nodeMap.get(nodeId);
          if (!node) return;
          const x = node.fx ?? node.x;
          const y = node.fy ?? node.y;
          if (x === undefined || y === undefined) return;
          const padding = node.isWorkspace ? 60 : 80;
          points.push([x - padding, y - padding]);
          points.push([x + padding, y - padding]);
          points.push([x - padding, y + padding]);
          points.push([x + padding, y + padding]);
        });
        return {
          id: note.id,
          color: note.color || '#8a42c1',
          hull: points.length > 2 ? d3.polygonHull(points) : null
        };
      });

      gHullsRef.current.selectAll('.cluster-hull')
        .data(clusters, d => d.id)
        .join(
          enter => enter.append('path').attr('class', 'cluster-hull')
            .attr('filter', 'url(#hull-glow)') 
            .style('fill', d => d.color).style('stroke', 'none').attr('d', d => d.hull ? lineGenerator(d.hull) : null),
          update => update.style('fill', d => d.color).attr('d', d => d.hull ? lineGenerator(d.hull) : null),
          exit => exit.remove()
        );
    };

    // --- MINIMAP RENDERER ---
    const updateMinimap = () => {
      const miniSvg = d3.select(minimapRef.current);
      if (miniSvg.empty()) return;
      const miniW = 200;
      const miniH = 140;

      // 1. Calculate World Bounds (Nodes)
      const currentNodes = gNodesRef.current ? gNodesRef.current.selectAll('.node-group').data() : [];
      if (currentNodes.length === 0) return;

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      currentNodes.forEach(d => {
         const x = d.fx ?? d.x; const y = d.fy ?? d.y;
         if (x < minX) minX = x; if (y < minY) minY = y;
         if (x > maxX) maxX = x; if (y > maxY) maxY = y;
      });
      // Add padding
      const padding = 100;
      minX -= padding; minY -= padding; maxX += padding; maxY += padding;
      const worldW = maxX - minX || 1000;
      const worldH = maxY - minY || 1000;

      // 2. Scale Scales
      const scaleX = d3.scaleLinear().domain([minX, maxX]).range([0, miniW]);
      const scaleY = d3.scaleLinear().domain([minY, maxY]).range([0, miniH]);

      // 3. Draw Dots
      miniSvg.selectAll('.minimap-node')
        .data(currentNodes)
        .join('circle')
        .attr('class', d => `minimap-node ${d.isWorkspace ? 'workspace' : ''}`)
        .attr('cx', d => scaleX(d.fx ?? d.x))
        .attr('cy', d => scaleY(d.fy ?? d.y))
        .attr('r', d => d.isWorkspace ? 4 : 2);

      // 4. Draw Viewport Rect
      const transform = d3.zoomTransform(svg.node());
      // Viewport in world coords:
      // visible_x0 = (0 - t.x) / k
      const vx = (-transform.x) / transform.k;
      const vy = (-transform.y) / transform.k;
      const vw = width / transform.k;
      const vh = height / transform.k;

      miniSvg.selectAll('.minimap-viewport')
        .data([1])
        .join('rect')
        .attr('class', 'minimap-viewport')
        .attr('x', scaleX(vx))
        .attr('y', scaleY(vy))
        .attr('width', scaleX(vx + vw) - scaleX(vx))
        .attr('height', scaleY(vy + vh) - scaleY(vy));
        
      // 5. Minimap Click/Drag Interaction
      const minimapClick = (event) => {
          const [mx, my] = d3.pointer(event, miniSvg.node());
          // Convert mini coords to world coords
          const targetWorldX = scaleX.invert(mx);
          const targetWorldY = scaleY.invert(my);
          
          // Center view on this world point
          // new_tx = width/2 - targetWorldX * k
          const k = transform.k;
          const tx = (width / 2) - targetWorldX * k;
          const ty = (height / 2) - targetWorldY * k;
          
          svg.transition().duration(500).call(zoomRef.current.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
      };
      
      miniSvg.on('click', minimapClick);
    };


    if (!gRef.current) {
      gRef.current = svg.append('g')
        .on('click', (event) => {
          if (!event.shiftKey && event.target.tagName === 'svg') {
             if (setSelectedNodeIds) setSelectedNodeIds(new Set());
             setActiveTabId(null);
          }
        }).on('dblclick.bg', (event) => { if (event.target.tagName === 'svg') event.stopPropagation(); });

      const defs = svg.append('defs');
      defs.append('marker').attr('id', 'arrowhead').attr('viewBox', '-0 -5 10 10').attr('refX', 28).attr('refY', 0).attr('orient', 'auto').attr('markerWidth', 6).attr('markerHeight', 6).append('path').attr('d', 'M0,-5L10,0L0,5').attr('class', 'arrowhead');
      const filter = defs.append('filter').attr('id', 'hull-glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
      filter.append('feGaussianBlur').attr('in', 'SourceGraphic').attr('stdDeviation', '12');

      gHullsRef.current = gRef.current.append('g').attr('class', 'hull-layer');
      gLinksRef.current = gRef.current.append('g').attr('class', 'link-layer');
      gMagnetRef.current = gRef.current.append('g').attr('class', 'magnet-layer');
      gNodesRef.current = gRef.current.append('g').attr('class', 'node-layer'); 
      
      zoomRef.current = d3.zoom().scaleExtent([0.1, 8])
        .filter(event => !event.ctrlKey && !event.shiftKey && event.type !== 'dblclick' && !event.target.closest('.node-group'))
        .on('zoom', (event) => {
          gRef.current.attr('transform', event.transform);
          setCurrentZoomLevel(event.transform.k); 
          // Trigger minimap update on zoom
          updateMinimap();
        });
      svg.call(zoomRef.current); 
      
      simulationRef.current = d3.forceSimulation()
        .force('charge', d3.forceManyBody().strength(-100)) 
        .force('center', d3.forceCenter(width / 2, height / 2).strength(0.01))
        .force('collide', d3.forceCollide().radius(d => d.isWorkspace ? 35 : 45).strength(1).iterations(2)) 
        .force('link', d3.forceLink().id(d => d.id).distance(d => d.type === 'cluster' ? 30 : 60).strength(d => d.type === 'cluster' ? 1 : 0.8))
        .velocityDecay(0.6) 
        .alphaMin(0.001) 
        .on('tick', () => {
          gNodesRef.current.selectAll('.node-group')
            .attr('transform', d => `translate(${d.fx ?? d.x}, ${d.fy ?? d.y})`)
            .classed('active', d => d.id === activeTabId)
            .classed('link-source', d => d.id === linkSourceNode); 
          gLinksRef.current.selectAll('.link line')
            .attr('x1', d => d.source.x).attr('y1', d => d.source.y).attr('x2', d => d.target.x).attr('y2', d => d.target.y);
          gLinksRef.current.selectAll('.link-label-group')
             .attr('transform', d => `translate(${(d.source.x + d.target.x)/2},${(d.source.y + d.target.y)/2})`);
          
          const currentNodes = gNodesRef.current.selectAll('.node-group').data();
          const currentLinks = gLinksRef.current.selectAll('.link').data();
          updateClusterHulls(currentNodes, currentLinks);
          // Trigger minimap update on tick
          updateMinimap();
        });
    }

    const simulation = simulationRef.current;

    // Visibility ...
    const collapsedWorkspaceIds = new Set(allNodes.filter(n => n.isWorkspace && n.collapsed).map(n => n.id));
    const hiddenNodeIds = new Set();
    links.forEach(link => {
      if (link.type === 'cluster') {
        const sourceId = link.source.id ?? link.source;
        const targetId = link.target.id ?? link.target;
        if (collapsedWorkspaceIds.has(sourceId)) hiddenNodeIds.add(targetId);
        if (collapsedWorkspaceIds.has(targetId)) hiddenNodeIds.add(sourceId);
      }
    });
    const visibleNodes = allNodes.filter(n => !hiddenNodeIds.has(n.id));
    const visibleLinks = links.filter(link => {
       const sourceId = link.source.id ?? link.source;
       const targetId = link.target.id ?? link.target;
       return !hiddenNodeIds.has(sourceId) && !hiddenNodeIds.has(targetId);
    });

    // Drag ... (Same)
    function nodeDragstarted(event, d) {
      d.dragStartTime = Date.now();
      d.dragStartX = event.x; d.dragStartY = event.y;
      if (!isLinking && !isDeleting && !isDeletingLink) {
        if(saveHistory) saveHistory();
        if (!event.active) simulation.alphaTarget(0.3).restart();
        delete d._tempPin; 
        if (selectedNodeIds && setSelectedNodeIds) {
            if (!selectedNodeIds.has(d.id) && !event.sourceEvent.shiftKey) { setSelectedNodeIds(new Set([d.id])); } 
            else if (!selectedNodeIds.has(d.id) && event.sourceEvent.shiftKey) { setSelectedNodeIds(prev => new Set(prev).add(d.id)); }
        }
        d.fx = d.x; d.fy = d.y;
        d3.select(this).raise(); svg.style('cursor', 'grabbing');
      }
    }
    function nodeDragged(event, d) {
      if (!isLinking && !isDeleting && !isDeletingLink) {
        d.fx = event.x; d.fy = event.y;
        d3.select(this).attr('transform', `translate(${d.fx}, ${d.fy})`);
        if (selectedNodeIds && selectedNodeIds.has(d.id)) {
           const dx = event.dx; const dy = event.dy;
           gNodesRef.current.selectAll('.node-group').filter(n => selectedNodeIds.has(n.id) && n.id !== d.id).each(function(n) {
                n.fx = (n.fx ?? n.x) + dx; n.fy = (n.fy ?? n.y) + dy;
                n.x += dx; n.y += dy;
                d3.select(this).attr('transform', `translate(${n.fx}, ${n.fy})`);
             });
        }
        // Magnet
        if (isMagnetMode && d.isWorkspace) {
           const MAGNET_RADIUS = 150;
           const candidates = [];
           const currentNodes = gNodesRef.current.selectAll('.node-group').data();
           currentNodes.forEach(node => {
               if (node.id === d.id || node.isWorkspace) return;
               const isLinked = links.some(l => {
                   const s = l.source.id ?? l.source; const t = l.target.id ?? l.target;
                   return (s === d.id && t === node.id) || (s === node.id && t === d.id);
               });
               if (isLinked) return;
               const nx = node.fx ?? node.x; const ny = node.fy ?? node.y;
               const dist = Math.hypot(d.fx - nx, d.fy - ny);
               if (dist < MAGNET_RADIUS) { candidates.push({ x: nx, y: ny }); }
           });
           gMagnetRef.current.selectAll('.magnet-line').remove();
           if (candidates.length > 0) {
               gMagnetRef.current.selectAll('.magnet-line').data(candidates).enter().append('line').attr('class', 'magnet-line').attr('x1', d.fx).attr('y1', d.fy).attr('x2', c => c.x).attr('y2', c => c.y);
           }
        }
      }
    }
    function nodeDragended(event, d) {
      const duration = Date.now() - d.dragStartTime;
      const distance = Math.hypot(event.x - d.dragStartX, event.y - d.dragStartY);
      const isHovered = d3.select(this).classed('is-hovered');
      if (!isHovered && !event.active) simulation.alphaTarget(0); 
      svg.style('cursor', 'grab');
      if (gMagnetRef.current) gMagnetRef.current.selectAll('.magnet-line').remove();
      if (duration < 250 && distance < 5) {
        if (!isHovered) { d.fx = null; d.fy = null; }
        if (d.isWorkspace && !isLinking && !isDeleting) { d.fx = null; d.fy = null; delete d._tempPin; setNotes(prev => prev.map(n => n.id === d.id ? { ...n, fx: null, fy: null } : n)); simulation.alpha(0.3).restart(); } 
        else if (!isHovered) { d.fx = null; d.fy = null; }
        // ... Click actions same as before ...
        if (event.sourceEvent.detail === 2 && d.isWorkspace) {
          event.sourceEvent.stopPropagation(); 
          const newName = prompt("Enter new workspace name:", d.title);
          if (newName) {
            if(saveHistory) saveHistory();
            setNotes(prev => prev.map(n => n.id === d.id ? {...n, title: newName} : n));
          }
          return; 
        }
        if (isDeleting) {
           if(saveHistory) saveHistory();
           if (d.isWorkspace) { setNotes(prev => prev.filter(n => n.id !== d.id)); } 
           else {
             if (window.chrome && chrome.tabs) chrome.tabs.remove(d.id); 
             else setTabs(prev => prev.filter(t => t.id !== d.id));
           }
           setLinks(prevLinks => prevLinks.filter(l => (l.source.id ?? l.source) !== d.id && (l.target.id ?? l.target) !== d.id));
           setIsDeleting(false);
        } else if (isLinking) {
           if (linkSourceNode === null) {
            setLinkSourceNode(d.id); setLinkingMessage("Click target node...");
          } else {
            if (linkSourceNode !== d.id) {
              const isNoteSource = allNodes.find(n => n.id === linkSourceNode)?.isWorkspace;
              const newLink = { source: linkSourceNode, target: d.id, type: isNoteSource ? 'cluster' : 'history' };
              const linkExists = links.some(l => ((l.source.id ?? l.source) === newLink.source && (l.target.id ?? l.target) === newLink.target) || ((l.source.id ?? l.source) === newLink.target && (l.target.id ?? l.target) === newLink.source));
              if (!linkExists) { if(saveHistory) saveHistory(); setLinks(prevLinks => [...prevLinks, newLink]); }
            }
            const isNoteSource = allNodes.find(n => n.id === linkSourceNode)?.isWorkspace;
            if (isNoteSource) { } else { setIsLinking(false); setLinkSourceNode(null); setLinkingMessage("Add Link"); }
          }
        } else {
          setActiveTabId(d.id);
          if (d.domain && window.chrome && chrome.tabs) chrome.tabs.update(d.id, { active: true });
        }
      } else {
        if (!isLinking && !isDeleting && !isDeletingLink) {
           // ... Magnet Link ...
           if (isMagnetMode && d.isWorkspace) {
               const MAGNET_RADIUS = 150; const newLinks = []; const currentNodes = gNodesRef.current.selectAll('.node-group').data();
               currentNodes.forEach(node => {
                   if (node.id === d.id || node.isWorkspace) return;
                   const isLinked = links.some(l => { const s = l.source.id ?? l.source; const t = l.target.id ?? l.target; return (s === d.id && t === node.id) || (s === node.id && t === d.id); });
                   if (isLinked) return;
                   const nx = node.fx ?? node.x; const ny = node.fy ?? node.y;
                   if (Math.hypot(d.fx - nx, d.fy - ny) < MAGNET_RADIUS) { newLinks.push({ source: d.id, target: node.id, type: 'cluster' }); }
               });
               if (newLinks.length > 0) { if(saveHistory) saveHistory(); setLinks(prev => [...prev, ...newLinks]); }
           }
           // Sync
           if (d.isWorkspace) { setNotes(prev => prev.map(n => n.id === d.id ? { ...n, x: d.x, y: d.y, fx: d.x, fy: d.y } : n)); } 
           else { if (!isHovered) { d.fx = null; d.fy = null; } setTabs(prev => prev.map(t => t.id === d.id ? { ...t, x: d.x, y: d.y, fx: null, fy: null } : t)); }
           const nodesToSync = new Set(selectedNodeIds); nodesToSync.add(d.id);
           const d3NodesMap = new Map(gNodesRef.current.selectAll('.node-group').data().map(n => [n.id, n]));
           if (nodesToSync.size > 0) {
              setNotes(prev => prev.map(n => { if (nodesToSync.has(n.id)) { const d3N = d3NodesMap.get(n.id); if (d3N) return { ...n, x: d3N.x, y: d3N.y, fx: d3N.fx, fy: d3N.fy }; } return n; }));
              setTabs(prev => prev.map(t => { if (nodesToSync.has(t.id)) { const d3N = d3NodesMap.get(t.id); if (d3N) return { ...t, x: d3N.x, y: d3N.y, fx: d3N.fx, fy: d3N.fy }; } return t; }));
          }
        }
      }
      delete d.dragStartTime; delete d.dragStartX; delete d.dragStartY;
    }
    const nodeDrag = d3.drag()
      .filter(event => event.detail !== 2 && !event.target.classList.contains('workspace-collapse-button') && !event.target.classList.contains('workspace-collapse-text') && !event.target.classList.contains('workspace-collapse-circle')) 
      .on('start', nodeDragstarted).on('drag', nodeDragged).on('end', nodeDragended);

    // Hydrate/Update logic ... (Same as before)
    const nodeMap = new Map(visibleNodes.map(node => [node.id, node]));
    const hydratedLinks = visibleLinks.map(link => ({ source: nodeMap.get(link.source.id ?? link.source), target: nodeMap.get(link.target.id ?? link.target), type: link.type, label: link.label })).filter(l => l.source && l.target);
    const linkSelection = gLinksRef.current.selectAll('.link').data(hydratedLinks, d => `${d.source.id}-${d.target.id}`);
    const linkEnter = linkSelection.enter().append('g').attr('class', 'link');
    linkEnter.append('line').attr('class', d => `link-line ${d.type || 'domain'}`).attr('marker-end', d => d.type === 'history' ? 'url(#arrowhead)' : null);
    const labelGroup = linkEnter.append('g').attr('class', 'link-label-group').style('display', d => d.type === 'cluster' ? 'none' : null).on('dblclick', (event, d) => { event.stopPropagation(); if (onLinkRename) onLinkRename(d); });
    labelGroup.append('rect').attr('class', 'link-label-bg').attr('rx', 4).attr('ry', 4).attr('x', -20).attr('y', -10).attr('width', 40).attr('height', 20).style('display', d => d.label ? null : 'none');
    labelGroup.append('text').attr('class', 'link-label-text').attr('text-anchor', 'middle').attr('dy', '0.3em').text(d => d.label || "");
    const linkUpdate = linkSelection.merge(linkEnter);
    linkUpdate.select('line').attr('class', d => `link-line ${d.type || 'domain'}`).attr('marker-end', d => d.type === 'history' ? 'url(#arrowhead)' : null);
    linkUpdate.select('.link-label-group').style('display', d => d.type === 'cluster' ? 'none' : null);
    linkUpdate.select('.link-label-text').text(d => d.label || "");
    linkUpdate.select('.link-label-bg').style('display', d => d.label ? null : 'none').attr('width', d => (d.label ? d.label.length * 7 + 10 : 0)).attr('x', d => (d.label ? -(d.label.length * 7 + 10)/2 : 0));
    linkUpdate.on('click', (event, d) => { if (isDeletingLink) { event.stopPropagation(); if(saveHistory) saveHistory(); const rawLinkToRemove = links.find(l => ((l.source.id ?? l.source) === d.source.id && (l.target.id ?? l.target) === d.target.id) || ((l.source.id ?? l.source) === d.target.id && (l.target.id ?? l.target) === d.source.id)); if (rawLinkToRemove) setLinks(prevLinks => prevLinks.filter(l => l !== rawLinkToRemove)); setIsDeletingLink(false); } });
    linkSelection.exit().remove();
    const nodeSelection = gNodesRef.current.selectAll('.node-group').data(visibleNodes, d => d.id);
    const nodeEnter = nodeSelection.enter().append('g').attr('class', 'node-group').attr('data-id', d => d.id).classed('workspace-node', d => d.isWorkspace);
    const tabEnter = nodeEnter.filter(d => !d.isWorkspace);
    tabEnter.append('circle').attr('class', 'tab-node-circle').attr('r', 20);
    tabEnter.append('image').attr('class', 'tab-node-image').attr('x', -12).attr('y', -12).attr('width', 24).attr('height', 24);
    tabEnter.append('image').attr('class', 'tab-node-thumbnail').attr('x', -40).attr('y', -25).attr('width', 80).attr('height', 50).attr('opacity', 0);
    tabEnter.append('text').attr('class','tab-node-label').attr('y', 35);
    const workspaceEnter = nodeEnter.filter(d => d.isWorkspace);
    workspaceEnter.append('circle').attr('class', 'workspace-circle').attr('r', 30);
    workspaceEnter.append('text').attr('class', 'workspace-label').attr('y', 48);
    const deleteButton = workspaceEnter.append('g').attr('class', 'workspace-delete-button').attr('transform', `translate(22, -22)`).on('click', (event, d) => { event.stopPropagation(); if(saveHistory) saveHistory(); setNotes(prev => prev.filter(note => note.id !== d.id)); setLinks(prevLinks => prevLinks.filter(link => (link.source.id ?? link.source) !== d.id && (link.target.id ?? link.target) !== d.id)); });
    deleteButton.append('circle').attr('class', 'workspace-delete-circle').attr('r', 7);
    deleteButton.append('text').attr('class', 'workspace-delete-text').attr('x', 0).attr('y', 0).attr('dy', '0.35em').attr('text-anchor', 'middle').text('X');
    const collapseButton = workspaceEnter.append('g').attr('class', 'workspace-collapse-button').attr('transform', `translate(-22, -22)`).on('click', (event, d) => { event.stopPropagation(); setNotes(prev => prev.map(n => n.id === d.id ? { ...n, collapsed: !n.collapsed } : n)); });
    collapseButton.append('circle').attr('class', 'workspace-collapse-circle').attr('r', 7);
    collapseButton.append('text').attr('class', 'workspace-collapse-text').attr('x', 0).attr('y', 0).attr('dy', '0.35em').attr('text-anchor', 'middle').text('-');
    const allMergedNodes = nodeSelection.merge(nodeEnter);
    const showThumbnails = currentZoomLevel > 1.5;
    allMergedNodes.classed('detailed', showThumbnails);
    const now = Date.now();
    allMergedNodes.style('opacity', d => { if (d.isWorkspace) return 1; const age = now - (d.lastAccessed || now); if (age < 30 * 60 * 1000) return 1; if (age < 4 * 60 * 60 * 1000) return 0.8; return 0.5; });
    allMergedNodes.style('filter', d => { if (d.isWorkspace) return null; const age = now - (d.lastAccessed || now); if (age > 4 * 60 * 60 * 1000) return 'grayscale(100%)'; return null; });
    const d3NodesMap = new Map(gNodesRef.current.selectAll('.node-group').data().map(n => [n.id, n]));
    visibleNodes.forEach(n => { const old = d3NodesMap.get(n.id); if (old) { n.x = old.x; n.y = old.y; n.vx = old.vx; n.vy = old.vy; } });
    allMergedNodes.select('.tab-node-circle').style('fill', d => d.isWorkspace ? null : colorScale(d.domain)).attr('opacity', d => (showThumbnails && d.thumbnailUrl) ? 0 : 1);
    allMergedNodes.select('.tab-node-image').attr('href', d => d.isWorkspace ? null : d.faviconUrl).attr('opacity', d => (showThumbnails && d.thumbnailUrl) ? 0 : 1);
    allMergedNodes.select('.tab-node-thumbnail').attr('href', d => d.thumbnailUrl).attr('opacity', d => (showThumbnails && d.thumbnailUrl) ? 1 : 0);
    allMergedNodes.select('.tab-node-label').text(d => { if (d.isWorkspace) return null; return d.title.length > 20 ? d.title.substring(0, 20) + '...' : d.title; }).attr('y', showThumbnails ? 40 : 35);
    allMergedNodes.select('.workspace-circle').style('fill', d => d.isWorkspace ? d3.color(d.color || '#8a42c1').copy({opacity: 0.1}) : null).style('stroke', d => d.isWorkspace ? (d.color || '#8a42c1') : null);
    allMergedNodes.select('.workspace-label').text(d => d.isWorkspace ? (d.title || d.text) : null).style('fill', d => d.isWorkspace ? (d.color || '#8a42c1') : null);
    allMergedNodes.select('.workspace-delete-circle').style('fill', d => d.isWorkspace ? d3.color(d.color || '#8a42c1').brighter(0.2).copy({opacity: 0.5}) : null).style('stroke', d => d.isWorkspace ? (d.color || '#8a42c1') : null);
    allMergedNodes.select('.workspace-collapse-circle').style('fill', d => d.isWorkspace ? d3.color(d.color || '#8a42c1').brighter(0.2).copy({opacity: 0.5}) : null).style('stroke', d => d.isWorkspace ? (d.color || '#8a42c1') : null);
    allMergedNodes.select('.workspace-collapse-text').text(d => d.collapsed ? '+' : '-');
    allMergedNodes.call(nodeDrag).on('contextmenu', (event, d) => { if (onNodeContextMenu) onNodeContextMenu(event, d); })
      .on('mouseover', (event, d) => {
        d3.select(event.currentTarget).classed('is-hovered', true);
        if (!isLinking && !isDeleting && !isDeletingLink && !d.dragStartTime) { 
           if (!d.isWorkspace) { d.fx = d.x; d.fy = d.y; d._tempPin = true; } 
           else if (d.fx == null) { d.fx = d.x; d.fy = d.y; d._tempPin = true; }
        }
        setTooltip({ visible: true, content: `<strong>${d.title}</strong><br />${d.isWorkspace ? 'Workspace' : d.domain}`, x: event.pageX, y: event.pageY });
      })
      .on('mousemove', (event) => setTooltip(prev => ({ ...prev, x: event.pageX, y: event.pageY }))).on('mouseout', (event, d) => {
        d3.select(event.currentTarget).classed('is-hovered', false);
        if (!isLinking && !isDeleting && !isDeletingLink && !d.dragStartTime) { 
           if (d._tempPin) { d.fx = null; d.fy = null; delete d._tempPin; }
           simulation.alphaTarget(0); 
        }
        setTooltip({ visible: false, content: '', x: 0, y: 0 });
      });
    nodeSelection.exit().remove();
    
    // ... (Rest: Search, Zoom, Peek, WASD logic same as before) ...
    const query = searchQuery.toLowerCase().trim();
    const allNodeElements = gNodesRef.current.selectAll('.node-group');
    const hullElements = gHullsRef.current.selectAll('.cluster-hull'); 
    if (query.length > 0) {
      const matchedNodeIds = new Set();
      if (searchMode === 'keyword') {
        allNodeElements.each(function(d) { if (d.title.toLowerCase().includes(query) || (d.domain && d.domain.toLowerCase().includes(query))) matchedNodeIds.add(d.id); });
      } else { 
        const seedNodeIds = new Set();
        allNodeElements.each(function(d) { if (d.title.toLowerCase().includes(query) || (d.domain && d.domain.toLowerCase().includes(query))) seedNodeIds.add(d.id); });
        const finalMatchedIds = new Set(seedNodeIds);
        const queue = [...seedNodeIds];
        while (queue.length > 0) {
          const currentId = queue.pop();
          hydratedLinks.forEach(link => {
            let neighborId = null;
            if (link.source.id === currentId && !finalMatchedIds.has(link.target.id)) neighborId = link.target.id;
            else if (link.target.id === currentId && !finalMatchedIds.has(link.source.id)) neighborId = link.source.id;
            if (neighborId) { finalMatchedIds.add(neighborId); queue.push(neighborId); }
          });
        }
        finalMatchedIds.forEach(id => matchedNodeIds.add(id));
      }
      allNodeElements.classed('faded', d => !matchedNodeIds.has(d.id)).classed('highlighted', d => matchedNodeIds.has(d.id));
      linkSelection.classed('faded', d => !matchedNodeIds.has(d.source.id) || !matchedNodeIds.has(d.target.id));
      hullElements.classed('faded', true); 
    } else if (focusNodeId) {
      const focusedNodeIds = new Set();
      const queue = [focusNodeId];
      focusedNodeIds.add(focusNodeId);
      while (queue.length > 0) {
        const currentId = queue.pop();
        hydratedLinks.forEach(link => {
          let neighborId = null;
          if (link.source.id === currentId && !focusedNodeIds.has(link.target.id)) neighborId = link.target.id;
          else if (link.target.id === currentId && !focusedNodeIds.has(link.source.id)) neighborId = link.source.id;
          if (neighborId) { focusedNodeIds.add(neighborId); queue.push(neighborId); }
        });
      }
      allNodeElements.classed('faded', d => !focusedNodeIds.has(d.id));
      linkSelection.classed('faded', d => !focusedNodeIds.has(d.source.id) || !focusedNodeIds.has(d.target.id));
      hullElements.classed('faded', d => !focusedNodeIds.has(d.id));
      allNodeElements.classed('highlighted', false);
    } else {
      allNodeElements.classed('faded', false).classed('highlighted', false);
      linkSelection.classed('faded', false);
      hullElements.classed('faded', false);
    }
    
    simulation.nodes(visibleNodes); 
    const physicsLinks = hydratedLinks.filter(l => l.type !== 'cluster');
    simulation.force('link').links(physicsLinks); 
    simulation.alpha(0.3).restart();
    updateClusterHulls(visibleNodes, hydratedLinks);
    updateMinimap();
  }, [allNodes, links, setLinks, setTabs, setNotes, isLinking, setIsLinking, linkSourceNode, setLinkSourceNode, setLinkingMessage, isDeleting, setIsDeleting, isDeletingLink, setIsDeletingLink, activeTabId, setActiveTabId, setTooltip, searchQuery, searchMode, focusNodeId, saveHistory, currentZoomLevel, onNodeContextMenu, selectedNodeIds, setSelectionRect, setSelectedNodeIds, onLinkRename]); 

  // Zoom to Fit
  useEffect(() => {
    if (zoomToFitTrigger === 0) return; 
    const svg = d3.select(svgRef.current);
    const g = gRef.current;
    const zoom = zoomRef.current;
    if (!g || !zoom) return; 
    const visibleNodes = g.selectAll('.node-group:not(.faded)');
    if (visibleNodes.empty()) {
       const parent = svg.node().getBoundingClientRect();
       const transform = d3.zoomIdentity.translate(parent.width / 2, parent.height / 2).scale(1);
       svg.transition().duration(750).call(zoom.transform, transform);
       return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    visibleNodes.each(function(d) {
      const pos = d.fx ? { x: d.fx, y: d.fy } : (d.x ? d : {x: 300, y: 300}); 
      const radius = d.isWorkspace ? 30 : 20; 
      minX = Math.min(minX, pos.x - radius);
      minY = Math.min(minY, pos.y - radius);
      maxX = Math.max(maxX, pos.x + radius);
      maxY = Math.max(maxY, pos.y + radius);
    });
    const parent = svg.node().getBoundingClientRect();
    const fullWidth = parent.width;
    const fullHeight = parent.height;
    const boundsWidth = maxX - minX;
    const boundsHeight = maxY - minY;
    if (boundsWidth === 0 || boundsHeight === 0 || !isFinite(boundsWidth) || !isFinite(boundsHeight)) {
       const parent = svg.node().getBoundingClientRect();
       const transform = d3.zoomIdentity.translate(parent.width / 2, parent.height / 2).scale(1);
       svg.transition().duration(750).call(zoom.transform, transform);
       return;
    }
    const scale = Math.min(fullWidth / boundsWidth, fullHeight / boundsHeight) * 0.9; 
    const translateX = (fullWidth / 2) - (minX + boundsWidth / 2) * scale;
    const translateY = (fullHeight / 2) - (minY + boundsHeight / 2) * scale;
    const transform = d3.zoomIdentity.translate(translateX, translateY).scale(scale);
    svg.transition().duration(750).call(zoom.transform, transform);
  }, [zoomToFitTrigger, allNodes, focusNodeId]); 

  // Jump Target
  useEffect(() => {
    if (!jumpTarget) return; 
    const svg = d3.select(svgRef.current);
    const zoom = zoomRef.current;
    if (!svg || !zoom) return;
    const parent = svg.node().getBoundingClientRect();
    const fullWidth = parent.width;
    const fullHeight = parent.height;
    const scale = 1.0; 
    const targetX = jumpTarget.fx ?? jumpTarget.x;
    const targetY = jumpTarget.fy ?? jumpTarget.y;
    const translateX = (fullWidth / 2) - (targetX * scale);
    const translateY = (fullHeight / 2) - (targetY * scale);
    const transform = d3.zoomIdentity.translate(translateX, translateY).scale(scale);
    svg.transition().duration(750).call(zoom.transform, transform);
  }, [jumpTarget]); 

  // Peek Mode
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Space' && !e.repeat && !e.target.matches('input, textarea')) {
        e.preventDefault();
        const svg = d3.select(svgRef.current);
        const g = gRef.current;
        const zoom = zoomRef.current;
        if (!svg || !g || !zoom) return;
        savedViewRef.current = d3.zoomTransform(svg.node());
        const visibleNodes = g.selectAll('.node-group:not(.faded)');
        if (visibleNodes.empty()) return;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        visibleNodes.each(function(d) {
          const pos = d.fx ? { x: d.fx, y: d.fy } : (d.x ? d : {x: 0, y: 0}); 
          const radius = d.isWorkspace ? 30 : 20; 
          minX = Math.min(minX, pos.x - radius);
          minY = Math.min(minY, pos.y - radius);
          maxX = Math.max(maxX, pos.x + radius);
          maxY = Math.max(maxY, pos.y + radius);
        });
        const parent = svg.node().getBoundingClientRect();
        const boundsWidth = maxX - minX;
        const boundsHeight = maxY - minY;
        if (boundsWidth === 0 || boundsHeight === 0 || !isFinite(boundsWidth)) return;
        const scale = Math.min(parent.width / boundsWidth, parent.height / boundsHeight) * 0.9; 
        const translateX = (parent.width / 2) - (minX + boundsWidth / 2) * scale;
        const translateY = (parent.height / 2) - (minY + boundsHeight / 2) * scale;
        const transform = d3.zoomIdentity.translate(translateX, translateY).scale(scale);
        svg.transition().duration(200).call(zoom.transform, transform);
      }
    };
    const handleKeyUp = (e) => {
      if (e.code === 'Space') {
         if (savedViewRef.current) {
            const svg = d3.select(svgRef.current);
            const zoom = zoomRef.current;
            const parent = svg.node().getBoundingClientRect();
            const transform = d3.zoomTransform(svg.node());
            const mx = mousePosRef.current.x - parent.left;
            const my = mousePosRef.current.y - parent.top;
            const graphX = (mx - transform.x) / transform.k;
            const graphY = (my - transform.y) / transform.k;
            const targetScale = savedViewRef.current.k;
            const tx = (parent.width / 2) - (graphX * targetScale);
            const ty = (parent.height / 2) - (graphY * targetScale);
            const newTransform = d3.zoomIdentity.translate(tx, ty).scale(targetScale);
            svg.transition().duration(300).call(zoom.transform, newTransform);
            savedViewRef.current = null;
         }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []); 

  // WASD
  useEffect(() => {
    const keysPressed = { KeyW: false, KeyA: false, KeyS: false, KeyD: false, ArrowUp: false, ArrowLeft: false, ArrowDown: false, ArrowRight: false };
    let animationFrameId;
    const PAN_SPEED = 15; 
    const handleKeyDown = (e) => {
      if (e.target.matches('input, textarea')) return;
      if (keysPressed.hasOwnProperty(e.code)) { keysPressed[e.code] = true; startPanLoop(); }
    };
    const handleKeyUp = (e) => { if (keysPressed.hasOwnProperty(e.code)) keysPressed[e.code] = false; };
    const panCanvas = () => {
      const svg = d3.select(svgRef.current);
      const zoom = zoomRef.current;
      if (!svg || !zoom) return;
      let dx = 0; let dy = 0;
      if (keysPressed['KeyW'] || keysPressed['ArrowUp']) dy += PAN_SPEED;
      if (keysPressed['KeyS'] || keysPressed['ArrowDown']) dy -= PAN_SPEED;
      if (keysPressed['KeyA'] || keysPressed['ArrowLeft']) dx += PAN_SPEED;
      if (keysPressed['KeyD'] || keysPressed['ArrowRight']) dx -= PAN_SPEED;
      if (dx !== 0 || dy !== 0) {
        zoom.translateBy(svg, dx / 1, dy / 1); 
        animationFrameId = requestAnimationFrame(panCanvas);
      } else {
        cancelAnimationFrame(animationFrameId); animationFrameId = null;
      }
    };
    const startPanLoop = () => { if (!animationFrameId) panCanvas(); };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, []); 

  return (
    <>
      <svg ref={svgRef} className="spatial-canvas-svg" />
      {/* Minimap Overlay */}
      <div className="minimap-container">
         <svg ref={minimapRef} width="100%" height="100%" style={{display: 'block'}}></svg>
      </div>
    </>
  );
});

export default SpatialCanvas;