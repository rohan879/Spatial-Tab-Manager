import * as d3 from 'd3';

// A simple placeholder image for testing
const MOCK_THUMB = "https://placehold.co/160x100/EEE/31343C?text=Preview";

export const initialTabs = [
  { 
    id: 1, 
    title: 'HCI - Wikipedia', 
    domain: 'wikipedia.org',
    faviconUrl: 'https://www.google.com/s2/favicons?domain=wikipedia.org&sz=64',
    thumbnailUrl: MOCK_THUMB 
  },
  { 
    id: 2, 
    title: 'D3.js Force-Directed Graph', 
    domain: 'observablehq.com',
    faviconUrl: 'https://www.google.com/s2/favicons?domain=observablehq.com&sz=64',
    thumbnailUrl: MOCK_THUMB
  },
  { 
    id: 3, 
    title: 'Obsidian.md', 
    domain: 'obsidian.md',
    faviconUrl: 'https://www.google.com/s2/favicons?domain=obsidian.md&sz=64',
    thumbnailUrl: MOCK_THUMB
  },
  { 
    id: 4, 
    title: 'Arc Browser', 
    domain: 'arc.net',
    faviconUrl: 'https://www.google.com/s2/favicons?domain=arc.net&sz=64',
    thumbnailUrl: MOCK_THUMB
  },
  { 
    id: 5, 
    title: 'Google Docs - Project Notes', 
    domain: 'google.com',
    faviconUrl: 'https://www.google.com/s2/favicons?domain=docs.google.com&sz=64',
    thumbnailUrl: MOCK_THUMB
  },
  { 
    id: 6, 
    title: 'HCI Project Ideas', 
    domain: 'google.com',
    faviconUrl: 'https://www.google.com/s2/favicons?domain=google.com&sz=64',
    thumbnailUrl: MOCK_THUMB
  },
  { 
    id: 7, 
    title: "Fitts's Law - Wikipedia", 
    domain: 'wikipedia.org',
    faviconUrl: 'https://www.google.com/s2/favicons?domain=wikipedia.org&sz=64',
    thumbnailUrl: MOCK_THUMB
  },
  { 
    id: 8, 
    title: 'Cognitive Load - Wikipedia', 
    domain: 'wikipedia.org',
    faviconUrl: 'https://www.google.com/s2/favicons?domain=wikipedia.org&sz=64',
    thumbnailUrl: MOCK_THUMB
  },
];

export const colorScale = d3.scaleOrdinal(d3.schemeTableau10)
  .domain([...new Set(initialTabs.map(d => d.domain))]);

export function generateLinks(tabs) {
  const links = [];
  const domains = {};

  tabs.forEach(tab => {
    if (!domains[tab.domain]) {
      domains[tab.domain] = [];
    }
    domains[tab.domain].push(tab.id);
  });

  for (const domain in domains) {
    const nodeIds = domains[domain];
    if (nodeIds.length > 1) {
      const firstNodeId = nodeIds[0];
      for (let i = 1; i < nodeIds.length; i++) {
        links.push({ 
          source: firstNodeId, 
          target: nodeIds[i], 
          type: 'domain' 
        });
      }
    }
  }
  return links;
}