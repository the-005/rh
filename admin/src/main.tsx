import * as React from "react";
import { createRoot } from "react-dom/client";
import { Link, Route, Switch, useRoute } from "wouter";
import { api } from "./api.ts";
import { CutterList, CutterView } from "./cutter.tsx";
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
  const [isCutterList] = useRoute("/cutter");
  const [isCutting, cut] = useRoute<{ project: string; item: string }>("/cutter/:project/:item");

  // Each page brings its own navigation bar (ui.tsx).
  return (
    <>
      {isCutting && cut ? (
        <CutterView
          key={`${cut.project}/${cut.item}`}
          project={decodeURIComponent(cut.project)}
          item={decodeURIComponent(cut.item)}
        />
      ) : isCutterList ? (
        <CutterList />
      ) : isNew || projectId ? (
        <Editor key={editorKey} id={projectId} />
      ) : (
        <Switch>
          <Route path="/">
            <List email={email} />
          </Route>
          <Route>
            <main className="page">
              <p className="notice">
                Nothing here. <Link href="/">All projects</Link>
              </p>
            </main>
          </Route>
        </Switch>
      )}
    </>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
