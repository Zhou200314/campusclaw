import { useCallback, useEffect, useState } from "react";
import LoginPage from "./pages/LoginPage";
import MaterialsPage from "./pages/MaterialsPage";
import SearchPage from "./pages/SearchPage";

export interface RouteProps {
  navigate: (to: string) => void;
}

function currentPath() {
  if (window.location.pathname === "/materials") return "/materials";
  if (window.location.pathname === "/search") return "/search";
  return "/";
}

export default function App() {
  const [path, setPath] = useState<string>(currentPath());

  useEffect(() => {
    const onPopState = () => setPath(currentPath());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((to: string) => {
    if (window.location.pathname !== to) {
      window.history.pushState({}, "", to);
    }
    setPath(to);
    window.scrollTo(0, 0);
  }, []);

  if (path === "/materials") {
    return <MaterialsPage navigate={navigate} />;
  }
  if (path === "/search") {
    return <SearchPage navigate={navigate} />;
  }
  return <LoginPage navigate={navigate} />;
}
