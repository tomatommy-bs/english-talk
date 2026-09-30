import { ChatLog } from "./components/ChatLog";
import { Composer } from "./components/Composer";
import { FeedbackPanel } from "./components/FeedbackPanel";
import { Header } from "./components/Header";
import { LookupPopup } from "./components/LookupPopup";
import { SummaryModal } from "./components/SummaryModal";

export function App() {
  return (
    <div className="flex h-full flex-col">
      <Header />
      <main className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,3fr)_minmax(0,2fr)] md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:grid-rows-1">
        <section className="flex min-h-0 flex-col border-line md:border-r">
          <ChatLog />
          <Composer />
        </section>
        <FeedbackPanel />
      </main>
      <LookupPopup />
      <SummaryModal />
    </div>
  );
}
