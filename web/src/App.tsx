import { BrowserRouter, Route, Routes } from "react-router";
import Navbar from "./components/Navbar";
import FetchPage from "./pages/FetchPage";
import MatchPage from "./pages/MatchPage";
import PlaylistPage from "./pages/PlaylistPage";
import SettingsPage from "./pages/SettingsPage";

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-900 text-slate-100">
        <Navbar />
        <main className="mx-auto max-w-6xl px-4 py-8">
          <Routes>
            <Route path="/" element={<FetchPage />} />
            <Route path="/playlist/:id" element={<PlaylistPage />} />
            <Route path="/match/:id" element={<MatchPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
