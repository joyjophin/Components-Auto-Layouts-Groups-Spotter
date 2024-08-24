const initialWidth = 300; // Replace with your desired initial width
figma.showUI(__html__, { width: initialWidth, height: 300 });

let highlightGroups: { [key: string]: GroupNode | null } = {
  'auto-layout': null,
  'no-auto-layout': null,
  'components': null,
  'not-components': null,
  'groups': null
};


let highlightColor = { r: 255/255, g: 0/255, b: 0/255 };

function checkInitialSelection() {
  const selection = figma.currentPage.selection;
  const frameCount = selection.filter(node => node.type === "FRAME").length;
  figma.ui.postMessage({ 
    type: 'selection-update', 
    count: frameCount
  });
}

figma.on("selectionchange", () => {
  checkInitialSelection();
});

checkInitialSelection();

figma.ui.onmessage = (msg) => {
  if (msg.type === 'analyze-layers') {
    const selection = figma.currentPage.selection;
    const frames = selection.filter(node => node.type === "FRAME");
    if (frames.length === 0) {
      figma.notify('No frames selected');
      return;
    }
    const result = analyzeFrames(frames);
    figma.ui.postMessage({ type: 'scan-result', ...result });
  } else if (msg.type === 'toggle-highlight') {
    toggleHighlight(msg.highlight, msg.highlightType);
  } else if (msg.type === 'change-highlight-color') {
    changeHighlightColor(msg.color);
  } else if (msg.type === 'start-fresh') {
    startFresh();
  }
  else if (msg.type === 'resize') {
        figma.ui.resize(initialWidth, msg.height);
    } 
};

function isInsideComponent(node: SceneNode): boolean {
  let parent = node.parent;
  while (parent) {
    if (parent.type === 'COMPONENT' || parent.type === 'INSTANCE') {
      return true;
    }
    parent = parent.parent;
  }
  return false;
}

function analyzeFrames(frames: FrameNode[]): { 
  totalLayers: number,
  totalFrames: number,
  parentFrames: number,
  withAutoLayout: number,
  withoutAutoLayout: number,
  components: number,
  notComponents: number,
  groups: number
} {
  let totalLayers = 0;
  let totalFrames = 0;
  let parentFrames = frames.length;
  let withAutoLayout = 0;
  let withoutAutoLayout = 0;
  let components = 0;
  let notComponents = 0;
  let groups = 0;

  function traverse(node: SceneNode, isInsideComponent: boolean = false) {
    totalLayers++;

    if (node.type === "GROUP") {
      groups++;
    }

    if (!isInsideComponent) {
      if (node.type === "FRAME" || node.type === "COMPONENT" || node.type === "INSTANCE") {
        totalFrames++;
        
        if (node.type === "FRAME") {
          if ('layoutMode' in node && node.layoutMode !== "NONE") {
            withAutoLayout++;
          } else {
            withoutAutoLayout++;
          }
          notComponents++;
        } else if (node.type === "COMPONENT" || node.type === "INSTANCE") {
          components++;
          isInsideComponent = true;
        }
      }
    }

    if ('children' in node) {
      node.children.forEach(child => traverse(child, isInsideComponent));
    }
  }

  frames.forEach(frame => traverse(frame));

  return { 
    totalLayers,
    totalFrames,
    parentFrames,
    withAutoLayout,
    withoutAutoLayout,
    components,
    notComponents,
    groups
  };
}


function toggleHighlight(highlight: boolean, type: string) {
  if (highlight) {
    // Remove all other highlights first
    Object.keys(highlightGroups).forEach(key => {
      if (key !== type) {
        removeHighlights(key);
      }
    });

    const selection = figma.currentPage.selection;
    let nodesToHighlight: SceneNode[] = [];

    function collectNodes(nodes: ReadonlyArray<SceneNode>) {
      nodes.forEach(node => {
        if (type === 'groups' && node.type === "GROUP") {
          nodesToHighlight.push(node);
        } else if (node.type === "FRAME") {
          nodesToHighlight.push(node);
        }
        if ('children' in node) {
          collectNodes(node.children);
        }
      });
    }

    collectNodes(selection);
    highlightNodes(nodesToHighlight, type);
  } else {
    removeHighlights(type);
  }
}

function highlightNodes(nodes: ReadonlyArray<SceneNode>, type: string) {
  removeHighlights(type);

  const highlightRects: RectangleNode[] = [];
  const processedNodes = new Set<string>(); // To keep track of processed nodes

  function processNode(node: SceneNode, isInsideComponent: boolean = false) {
    // If we've already processed this node, skip it
    if (processedNodes.has(node.id)) {
      return;
    }

    let shouldHighlight = false;

    switch (type) {
      case 'auto-layout':
        shouldHighlight = !isInsideComponent && node.type === 'FRAME' && 'layoutMode' in node && node.layoutMode !== "NONE";
        break;
      case 'no-auto-layout':
        shouldHighlight = !isInsideComponent && node.type === 'FRAME' && 'layoutMode' in node && node.layoutMode === "NONE";
        break;
      case 'components':
        shouldHighlight = !isInsideComponent && (node.type === 'COMPONENT' || node.type === 'INSTANCE');
        break;
      case 'not-components':
        shouldHighlight = !isInsideComponent && node.type === 'FRAME';
        break;
      case 'groups':
        shouldHighlight = node.type === 'GROUP';
        break;
    }

    if (shouldHighlight) {
      const absolutePosition = getAbsolutePosition(node);
      
      // Check if the node has valid dimensions before creating the highlight rectangle
      if (node.width >= 0.01 && node.height >= 0.01) {
        const rect = figma.createRectangle();
        rect.resize(Math.max(node.width, 0.01), Math.max(node.height, 0.01));
        rect.x = absolutePosition.x;
        rect.y = absolutePosition.y;
        rect.fills = [];
        rect.strokeWeight = 4;
        rect.strokes = [{ type: 'SOLID', color: highlightColor }];
        rect.opacity = 0.8;
        highlightRects.push(rect);
      } else {
        console.warn(`Skipped highlighting for node with invalid dimensions: ${node.name}`);
      }
    }

    // Mark this node as processed
    processedNodes.add(node.id);

    // Process children
    if ('children' in node) {
      const newIsInsideComponent = isInsideComponent || node.type === 'COMPONENT' || node.type === 'INSTANCE';
      for (const child of node.children) {
        processNode(child, newIsInsideComponent);
      }
    }
  }

  nodes.forEach(node => processNode(node));

  if (highlightRects.length > 0) {
    highlightGroups[type] = figma.group(highlightRects, figma.currentPage);
    highlightGroups[type]!.name = `Highlights - ${type}`;
    highlightGroups[type]!.locked = true;
  }

  console.log(`Highlighted ${highlightRects.length} ${type} nodes`);
}

function removeHighlights(type: string) {
  try {
    if (highlightGroups[type]) {
      highlightGroups[type]!.remove();
      highlightGroups[type] = null;
    }
  } catch (error) {
    console.error('Error removing highlights:', error);
    // You can also display a user-friendly message using figma.notify()
    figma.notify('Failed to remove highlights. Please try again.');
  }
}

function getAbsolutePosition(node: SceneNode): { x: number, y: number } {
  let x = 'x' in node ? node.x : 0;
  let y = 'y' in node ? node.y : 0;
  let parent = node.parent;

  while (parent && parent.type !== 'PAGE') {
    if ('x' in parent && 'y' in parent) {
      x += parent.x;
      y += parent.y;
    }
    parent = parent.parent;
  }

  return { x, y };
}

function changeHighlightColor(color: string) {
  const r = parseInt(color.slice(1, 3), 16) / 255;
  const g = parseInt(color.slice(3, 5), 16) / 255;
  const b = parseInt(color.slice(5, 7), 16) / 255;
  highlightColor = { r, g, b };

  // Update existing highlights
  Object.keys(highlightGroups).forEach(type => {
    if (highlightGroups[type]) {
      highlightGroups[type]!.findAll(node => node.type === 'RECTANGLE').forEach(rect => {
        if (rect.type === 'RECTANGLE') {
          rect.strokes = [{ type: 'SOLID', color: highlightColor }];
        }
      });
    }
  });
}

function removeAllHighlights() {
  try {
    Object.keys(highlightGroups).forEach(removeHighlights);
  } catch (error) {
    console.error('Error removing all highlights:', error);
    figma.notify('Failed to remove all highlights. Please try again.');
  }
}

function startFresh() {
  try {
    removeAllHighlights();
    figma.currentPage.selection = [];
    figma.viewport.scrollAndZoomIntoView([]);
    checkInitialSelection();
  } catch (error) {
    console.error('Error starting fresh:', error);
    figma.notify('Failed to start fresh. Please try again.');
  }
}