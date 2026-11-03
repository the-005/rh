import * as React from "react";
import { createRoot } from "react-dom/client";
import { Link, Route, Switch, useRoute } from "wouter";
import { api } from "./api.ts";
import { createdHere, Editor } from "./editor.tsx";
import { List } from "./list.tsx";
import "./style.css";

function App() {
  const [email, setEmail] = React.useState("");
  React.useEffect(() => {
    api.me().then(
      (me) => setEmail(me.email),
      () => setEmail("")
    );
  }, []);

  const [isNew] = useRoute("/new");
  const [isProject, params] = useRoute<{ id: string }>("/p/:id");
  const projectId = isProject && params ? decodeURIComponent(params.id) : null;
  // Keyed by project, so moving between projects starts each one fresh; a
  // project saved for the first time keeps its editor (and the previews of
  // its uploads) as the address changes from /new to its own.
  const editorKey = !projectId || createdHere.has(projectId) ? "new" : projectId;

  return (
    <>
      <header className="top">
        <Link href="/" className="brand">
          rh admin
        </Link>
        <span className="who">{email && `Signed in as ${email}`}</span>
      </header>
      <main>
        {isNew || projectId ? (
          <Editor key={editorKey} id={projectId} />
        ) : (
          <Switch>
            <Route path="/" component={List} />
            <Route>
              <p className="notice">
                Nothing here. <Link href="/">All projects</Link>
              </p>
            </Route>
          </Switch>
        )}
      </main>
    </>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
