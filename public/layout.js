// dir: 'vertical' = side-by-side, 'horizontal' = top/bottom
function splitPane(pane, dir) {
  const parentEl = pane.el.parentElement;
  const newPane = createPane();

  const container = document.createElement('div');
  container.className = `split-container ${dir}`;

  const divider = document.createElement('div');
  divider.className = 'split-divider';

  parentEl.replaceChild(container, pane.el);
  container.appendChild(pane.el);
  container.appendChild(divider);
  container.appendChild(newPane.el);

  pane.el.style.flex = '1';
  newPane.el.style.flex = '1';

  makeDraggable(divider, container, dir);

  addTab(newPane, 'terminal');
  setActivePane(newPane);
  return newPane;
}

function makeDraggable(divider, container, dir) {
  divider.addEventListener('mousedown', (startE) => {
    startE.preventDefault();
    divider.classList.add('dragging');
    const isVert = dir === 'vertical';
    const startPos = isVert ? startE.clientX : startE.clientY;
    const children = [...container.children].filter(c => !c.classList.contains('split-divider'));
    const startSize = children[0].getBoundingClientRect()[isVert ? 'width' : 'height'];
    const totalSize = isVert ? container.offsetWidth : container.offsetHeight;

    const onMove = (e) => {
      const delta = (isVert ? e.clientX : e.clientY) - startPos;
      const newSize = Math.max(80, Math.min(totalSize - 84, startSize + delta));
      children[0].style.flex = `0 0 ${newSize}px`;
      children[1].style.flex = '1';
      getAllPanes().forEach(p => {
        const tab = p.activeTab;
        if (tab?.fitAddon) tab.fitAddon.fit();
      });
    };

    const onUp = () => {
      divider.classList.remove('dragging');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}
