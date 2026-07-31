import { useState } from 'react';
import { motion } from 'framer-motion';
import { Moon, Sun } from 'lucide-react';
import { getTheme, setTheme } from '../lib/theme.js';

// Light/dark toggle. The theme is already applied pre-render by the inline
// script in index.html; this just flips and persists it.
export default function ThemeToggle() {
  const [theme, set] = useState(getTheme);
  const dark = theme === 'dark';

  const toggle = () => {
    const next = dark ? 'light' : 'dark';
    setTheme(next);
    set(next);
  };

  return (
    <button
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Light mode' : 'Dark mode'}
      className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#e8e2d4] bg-white text-slate-500 transition hover:border-gold-300 hover:text-brand-700"
    >
      <motion.span
        key={theme}
        initial={{ rotate: -90, opacity: 0, scale: 0.6 }}
        animate={{ rotate: 0, opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      >
        {dark ? <Sun size={17} /> : <Moon size={17} />}
      </motion.span>
    </button>
  );
}
