// Shared entrance presets for card grids: parent staggers, children rise on a
// spring. Used across Assets/Goals/Cash so the whole app moves the same way.
export const gridStagger = { hidden: {}, show: { transition: { staggerChildren: 0.07 } } };

export const cardRise = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 240, damping: 26 } },
};

// True when the page loaded in a visible tab — entrance/count-up animations
// should only play then, so a background-tab load never shows a stuck state.
export const pageVisible = () =>
  typeof document === 'undefined' || document.visibilityState === 'visible';
