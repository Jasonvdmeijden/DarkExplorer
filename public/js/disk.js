/* Disk Usage Analyzer — DaisyDisk-style visual sunburst chart */
const DiskAnalyzer = (() => {
  let tabsEl, breadcrumbEl, statusEl, svg, arcsGroup, centerCircle, centerText, listContainer, listTitle, listSize;
  let fullTree = null;
  let currentRoot = null;
  let activeRootPath = null;
  
  const COLORS = ['#ff5f56', '#ffbd2e', '#27c93f', '#42a5f5', '#a29bfe', '#fdcb6e', '#00b894', '#00cec9', '#0984e3', '#e84393'];

  function init() {
    tabsEl       = document.getElementById('disk-tabs');
    breadcrumbEl = document.getElementById('disk-breadcrumb');
    statusEl     = document.getElementById('disk-status');
    svg          = document.getElementById('disk-svg');
    arcsGroup    = document.getElementById('disk-arcs');
    centerCircle = document.getElementById('disk-center');
    centerText   = document.getElementById('disk-center-text');
    listContainer= document.getElementById('disk-list');
    
    listTitle = document.getElementById('disk-list-title');
    listSize  = document.getElementById('disk-list-size');

    if (listTitle) listTitle.addEventListener('click', navigateUp);

    document.getElementById('btn-disk').addEventListener('click', () => {
      try {
        console.log('[DiskAnalyzer] btn-disk clicked, creating tab...');
        if (typeof Tabs !== 'undefined') {
          Tabs.create('Disk Analyzer', '__disk__');
        } else {
          console.error('[DiskAnalyzer] Tabs module is not available.');
        }
      } catch (e) {
        console.error('[DiskAnalyzer] Failed to create tab:', e);
      }
    });
    
    const closeBtn = document.getElementById('btn-disk-close');
    if (closeBtn) closeBtn.style.display = 'none';
    if (centerCircle) centerCircle.addEventListener('click', navigateUp);

    WS.on('disk:progress', (data) => {
      statusEl.textContent = `Scanning: ${data.scanned} items...`;
    });
  }

  function formatSize(b) {
    if (!b) return '0 B';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
    if (b < 1073741824) return (b/1048576).toFixed(1) + ' MB';
    return (b/1073741824).toFixed(1) + ' GB';
  }

  async function open() {
    const roots = await WS.send('fs:roots', {});
    
    tabsEl.innerHTML = '';
    roots.forEach((r, idx) => {
      const btn = document.createElement('button');
      btn.className = 'disk-tab' + (idx === 0 ? ' active' : '');
      btn.textContent = r.name || r.path;
      btn.addEventListener('click', () => {
        tabsEl.querySelectorAll('.disk-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        scanDrive(r.path);
      });
      tabsEl.appendChild(btn);
    });
    
    if (roots.length > 0) {
      scanDrive(roots[0].path);
    }
  }

  function close() {
    statusEl.textContent = '';
  }

  async function scanDrive(path) {
    activeRootPath = path;
    if (arcsGroup) arcsGroup.innerHTML = '';
    listContainer.innerHTML = '';
    breadcrumbEl.innerHTML = '';
    statusEl.textContent = 'Preparing scan...';
    if (listTitle) listTitle.textContent = 'Scanning...';
    if (listSize) listSize.textContent = '';
    if (centerText) centerText.innerHTML = `<tspan x="300" dy="-10">Scanning...</tspan>`;
    if (centerCircle) centerCircle.setAttribute('fill', '#333');
    
    try {
      fullTree = await WS.send('disk:scan', { path });
      statusEl.textContent = 'Scan complete.';
      linkParents(fullTree);
      
      // Assign persistent colors at depth 1 so they stay consistent while drilling down
      if (fullTree && fullTree.children) {
         fullTree.children.sort((a,b) => b.size - a.size).forEach((c, i) => {
             assignColors(c, i);
         });
      }
      
      drillDown(fullTree);
      setTimeout(() => { statusEl.textContent = ''; }, 3000);
    } catch (e) {
      statusEl.textContent = 'Error: ' + e.message;
      if (listTitle) listTitle.textContent = 'Failed';
      if (centerText) centerText.innerHTML = `<tspan x="300" dy="0">Failed</tspan>`;
    }
  }

  function assignColors(node, colorIdx) {
      if (node.fixedColor) {
          node.color = node.fixedColor;
      } else if (node.isGroup) {
          node.color = '#555';
      } else {
          node.color = COLORS[colorIdx % COLORS.length];
      }
      if (node.children) {
          node.children.forEach(c => assignColors(c, colorIdx));
      }
  }

  function linkParents(node, parent = null) {
    node.parent = parent;
    if (node.children) {
      node.children.forEach(c => linkParents(c, node));
    }
  }

  function drillDown(node) {
    currentRoot = node;
    renderBreadcrumbs(node);
    renderList(node);
    if (svg) renderSunburst(node);
  }

  function navigateUp() {
    if (currentRoot && currentRoot.parent) {
      drillDown(currentRoot.parent);
    }
  }

  function renderBreadcrumbs(node) {
    const parts = [];
    let curr = node;
    while(curr) {
      parts.unshift(curr);
      curr = curr.parent;
    }
    
    breadcrumbEl.innerHTML = '';
    parts.forEach((p, idx) => {
      if (idx > 0) {
        const sep = document.createElement('span');
        sep.className = 'disk-sep';
        sep.textContent = '›';
        breadcrumbEl.appendChild(sep);
      }
      const crumb = document.createElement('span');
      crumb.className = 'disk-crumb';
      crumb.textContent = p.name || p.path;
      crumb.addEventListener('click', () => drillDown(p));
      breadcrumbEl.appendChild(crumb);
    });
  }

  // Math for SVG Arcs
  function describeArc(x, y, innerRadius, outerRadius, startAngle, endAngle) {
    // SVG arcs cannot draw a full 360 circle in one path command reliably.
    if (endAngle - startAngle >= 360) endAngle = startAngle + 359.99;
    
    const startOut = polarToCartesian(x, y, outerRadius, endAngle);
    const endOut   = polarToCartesian(x, y, outerRadius, startAngle);
    const startIn  = polarToCartesian(x, y, innerRadius, endAngle);
    const endIn    = polarToCartesian(x, y, innerRadius, startAngle);
    
    const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
    
    return [
      "M", startOut.x, startOut.y,
      "A", outerRadius, outerRadius, 0, largeArcFlag, 0, endOut.x, endOut.y,
      "L", endIn.x, endIn.y,
      "A", innerRadius, innerRadius, 0, largeArcFlag, 1, startIn.x, startIn.y,
      "Z"
    ].join(" ");
  }

  function polarToCartesian(centerX, centerY, radius, angleInDegrees) {
    const angleInRadians = (angleInDegrees - 90) * Math.PI / 180.0;
    return {
      x: centerX + (radius * Math.cos(angleInRadians)),
      y: centerY + (radius * Math.sin(angleInRadians))
    };
  }

  function renderSunburst(node) {
    arcsGroup.innerHTML = '';
    
    centerCircle.setAttribute('fill', node.parent ? '#444' : '#333');
    centerText.innerHTML = `
      <tspan x="300" dy="-10" font-size="22" font-weight="600" fill="#fff">${formatSize(node.size)}</tspan>
      <tspan x="300" dy="24" font-size="12" fill="#aaa">${node.parent ? 'Back' : 'Total'}</tspan>
    `;

    const MAX_DEPTH = 6;
    const RADIUS_STEP = 35;
    const CENTER_R = 75;
    
    if (!node.children || node.children.length === 0) return;
    
    node.children.sort((a, b) => b.size - a.size);
    
    function assignLayout(n, startA, endA, depth) {
      n.startA = startA;
      n.endA = endA;
      n.depth = depth;
      
      const sweep = endA - startA;
      
      // Only draw if the sweep is visibly large enough (e.g. > 0.1 degrees)
      if (depth > 0 && depth <= MAX_DEPTH && sweep > 0.1) {
        const arc = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const rIn = CENTER_R + (depth - 1) * RADIUS_STEP;
        const rOut = rIn + RADIUS_STEP - 1.5; // gap between rings
        
        const opacity = Math.max(0.3, 1 - ((depth - 1) * 0.18));
        
        try {
          // -0.3 creates a tiny gap between adjacent slices on the same ring
          arc.setAttribute('d', describeArc(300, 300, rIn, rOut, startA, Math.max(startA + 0.01, endA - 0.3)));
          arc.setAttribute('fill', n.color || '#555');
          arc.setAttribute('opacity', n.isGroup ? '0.4' : opacity.toString());
          arc.setAttribute('class', 'disk-arc');
          arc.dataset.path = n.path;
          
          if (n.isDir && !n.isGroup) {
            arc.style.cursor = 'pointer';
            arc.addEventListener('click', () => drillDown(n));
          }

          arc.addEventListener('mouseenter', () => {
            arc.setAttribute('opacity', '1');
            arc.style.transform = 'scale(1.03)';
            const listItem = document.querySelector(`.disk-list-item[data-path="${CSS.escape(n.path)}"]`);
            if (listItem) listItem.style.background = 'rgba(255,255,255,0.1)';
          });
          arc.addEventListener('mouseleave', () => {
            arc.setAttribute('opacity', n.isGroup ? '0.4' : opacity.toString());
            arc.style.transform = '';
            const listItem = document.querySelector(`.disk-list-item[data-path="${CSS.escape(n.path)}"]`);
            if (listItem) listItem.style.background = '';
          });
          
          arcsGroup.appendChild(arc);
        } catch (err) {
          console.error('[DiskAnalyzer] Error drawing arc:', err);
        }
      }
      
      if (n.children && depth < MAX_DEPTH && sweep > 0.1) {
        let currA = startA;
        n.children.forEach((c) => {
          const safeNodeSize = n.size > 0 ? n.size : 1; 
          const childSweep = (c.size / safeNodeSize) * sweep;
          assignLayout(c, currA, currA + childSweep, depth + 1);
          currA += childSweep;
        });
      }
    }
    
    assignLayout(node, 0, 359.99, 0);
  }

  function renderList(node) {
    listContainer.innerHTML = '';
    
    if (listTitle) listTitle.innerHTML = node.parent ? `↑ ${node.name || node.path}` : (node.name || node.path);
    if (listSize) listSize.textContent = formatSize(node.size);
    
    if (!node.children || node.children.length === 0) {
        listContainer.innerHTML = '<div style="padding:1rem; color:#aaa; font-size:.85rem; text-align:center;">Folder is empty</div>';
        return;
    }

    node.children.sort((a, b) => b.size - a.size);
    
    const maxVal = node.size > 0 ? node.size : 1;

    node.children.forEach(c => {
      const pct = Math.max(1, (c.size / maxVal) * 100);
      const color = c.color || '#555';
      
      const div = document.createElement('div');
      div.className = 'disk-list-item' + (c.isGroup ? ' group' : '');
      div.dataset.path = c.path;
      
      div.style.cssText = `
        position: relative;
        overflow: hidden;
        margin-bottom: 4px;
        background: rgba(0,0,0,0.2);
      `;

      div.innerHTML = `
        <div style="position:absolute; left:0; top:0; bottom:0; width:${pct}%; background:${color}; opacity:0.3; pointer-events:none;"></div>
        <span class="color-dot" style="background:${color}; opacity:${c.isGroup ? '0.5' : '1'}; z-index:1; position:relative;"></span>
        <span class="name" title="${c.name}" style="z-index:1; position:relative; ${c.isDir && !c.isGroup ? 'cursor:pointer' : ''}">${c.name}</span>
        <span class="size" style="z-index:1; position:relative;">${formatSize(c.size)}</span>
        ${c.isGroup ? '' : `<button class="del-btn" style="z-index:2; position:relative;" title="Delete forever">🗑</button>`}
      `;
      
      if (c.isDir && !c.isGroup) {
        div.querySelector('.name').addEventListener('click', () => drillDown(c));
      }

      // Link List Hover to SVG
      div.addEventListener('mouseenter', () => {
        const arc = document.querySelector(`.disk-arc[data-path="${CSS.escape(c.path)}"]`);
        if (arc) { arc.setAttribute('opacity', '1'); arc.style.transform = 'scale(1.03)'; }
      });
      div.addEventListener('mouseleave', () => {
        const arc = document.querySelector(`.disk-arc[data-path="${CSS.escape(c.path)}"]`);
        if (arc) {
          const opacity = Math.max(0.3, 1 - ((c.depth - 1) * 0.18));
          arc.setAttribute('opacity', c.isGroup ? '0.4' : opacity.toString()); 
          arc.style.transform = ''; 
        }
      });
      
      const delBtn = div.querySelector('.del-btn');
      if (delBtn) {
        delBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (confirm(`Delete ${c.name} (${formatSize(c.size)}) permanently?`)) {
            try {
              statusEl.textContent = 'Deleting...';
              await WS.send('fs:delete', { paths: [c.path] });
              // Locally update tree to avoid full rescan
              removeNodeSize(c);
              drillDown(node); // Re-render from current view
              if (window.Explorer && Explorer.refresh) Explorer.refresh();
              statusEl.textContent = `Deleted ${c.name}`;
              setTimeout(() => { statusEl.textContent = ''; }, 3000);
            } catch (err) {
              alert('Delete failed: ' + err.message);
              statusEl.textContent = '';
            }
          }
        });
      }
      listContainer.appendChild(div);
    });
  }

  function removeNodeSize(nodeToRemove) {
    const parent = nodeToRemove.parent;
    if (!parent) return; // Cannot delete root
    
    // Remove from parent's children
    parent.children = parent.children.filter(c => c !== nodeToRemove);
    
    // Subtract size all the way up the tree
    const sizeDiff = nodeToRemove.size;
    let curr = parent;
    while(curr) {
      curr.size -= sizeDiff;
      curr = curr.parent;
    }
  }

  return { init, open, close };
})();

// Self-initialize once the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('btn-disk')) {
    DiskAnalyzer.init();
  }
});
