import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./components/theme-provider";
import { ViewerI18nProvider } from "./i18n";
import "./app.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing viewer root element");
}

createRoot(rootElement).render(
  <StrictMode>
    <ViewerI18nProvider>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
        <App />
      </ThemeProvider>
    </ViewerI18nProvider>
  </StrictMode>,
);
