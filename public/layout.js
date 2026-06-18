// Distribute a split-container's direct children (panes and nested containers)
// equally, so N siblings each get 1/N of the axis.
function equalizeChildren(container) {
  [...container.children]
    .filter(c => !c.classList.contains('split-divider'))
    .forEach(c => { c.style.flex = '1 1 0'; });
}

// dir: 'vertical' = side-by-side, 'horizontal' = top/bottom
function splitPane(pane, dir) {
  const parentEl = pane.el.parentElement;
  const newPane = createPane();

  const divider = document.createElement('div');
  divider.className = 'split-divider';

  if (parentEl.classList.contains('split-container') && parentEl.classList.contains(dir)) {
    // Parent already tiles in this direction → add the new pane as a flat
    // sibling and redistribute, so the row/column stays uniform (e.g. 2 panes
    // become 3 equal thirds) instead of building a lopsided nested split.
    pane.el.after(divider, newPane.el);
    makeDraggable(divider, parentEl, dir);
    equalizeChildren(parentEl);
  } else {
    // Splitting in the other direction (or the very first split): wrap this pane
    // in a new container. The container inherits the pane's flex so it occupies
    // exactly the pane's old slot — neighbours on the outer axis don't move.
    const container = document.createElement('div');
    container.className = `split-container ${dir}`;
    container.style.flex = pane.el.style.flex || '1 1 0';
    parentEl.replaceChild(container, pane.el);
    container.append(pane.el, divider, newPane.el);
    pane.el.style.flex = '1 1 0';
    newPane.el.style.flex = '1 1 0';
    makeDraggable(divider, container, dir);
  }

  addTab(newPane, 'terminal');
  setActivePane(newPane);
  saveSessionState();
  return newPane;
}

// A divider resizes only the two children immediately on either side of it,
// trading size between them while keeping their combined size constant — so
// every other pane in the container is untouched. Sizes are tracked as unitless
// flex-grow ratios, which stay correct across window/screen sizes.
function makeDraggable(divider, container, dir) {
  // Pointer Events cover mouse, touch and pen with one code path.
  divider.style.touchAction = 'none'; // stop the browser scrolling while resizing
  divider.addEventListener('pointerdown', (startE) => {
    const prev = divider.previousElementSibling;
    const next = divider.nextElementSibling;
    if (!prev || !next) return;
    startE.preventDefault();
    divider.setPointerCapture(startE.pointerId);
    divider.classList.add('dragging');

    const isVert = dir === 'vertical';
    const dim = isVert ? 'width' : 'height';
    const startPos = isVert ? startE.clientX : startE.clientY;
    const prevPx = prev.getBoundingClientRect()[dim];
    const nextPx = next.getBoundingClientRect()[dim];
    const combinedPx = prevPx + nextPx;
    const prevGrow = parseFloat(getComputedStyle(prev).flexGrow) || 1;
    const nextGrow = parseFloat(getComputedStyle(next).flexGrow) || 1;
    const combinedGrow = prevGrow + nextGrow;
    const growPerPx = combinedPx > 0 ? combinedGrow / combinedPx : 0;

    const onMove = (e) => {
      if (e.pointerId !== startE.pointerId) return;
      const delta = (isVert ? e.clientX : e.clientY) - startPos;
      const newPrevPx = Math.max(80, Math.min(combinedPx - 80, prevPx + delta));
      const newPrevGrow = newPrevPx * growPerPx;
      prev.style.flex = `${newPrevGrow} 1 0`;
      next.style.flex = `${combinedGrow - newPrevGrow} 1 0`;
      getAllPanes().forEach(p => {
        const tab = p.activeTab;
        if (tab?.fitAddon) tab.fitAddon.fit();
      });
    };

    const onUp = (e) => {
      if (e.pointerId !== startE.pointerId) return;
      divider.classList.remove('dragging');
      divider.releasePointerCapture?.(startE.pointerId);
      divider.removeEventListener('pointermove', onMove);
      divider.removeEventListener('pointerup', onUp);
      divider.removeEventListener('pointercancel', onUp);
      saveSessionState();
    };

    // With pointer capture, move/up events retarget to the divider itself.
    divider.addEventListener('pointermove', onMove);
    divider.addEventListener('pointerup', onUp);
    divider.addEventListener('pointercancel', onUp);
  });
}
