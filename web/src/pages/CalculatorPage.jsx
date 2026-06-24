import CalculatorTool from '../components/CalculatorTool.jsx';

// The calculator inside the app shell, so logged-in customers can plan without
// signing out. Same tool as the public page, just without the marketing chrome.
export default function CalculatorPage() {
  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-500">
        Plan a SIP or lumpsum, or work out what to invest to reach a goal — with step-up and inflation.
        These are estimates for planning, separate from your tracked portfolio.
      </p>

      {/* top-20 clears the sticky app header so the result stays visible while scrolling */}
      <CalculatorTool stickyTop="top-20" />

      <p className="text-center text-xs text-slate-400">
        Estimates for planning only, not investment advice. Returns are assumed and not guaranteed.
      </p>
    </div>
  );
}
