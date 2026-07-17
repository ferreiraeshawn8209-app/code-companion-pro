import { useState } from "react";
import { File, FileCode, Folder, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

export interface WsFile {
  id: string;
  path: string;
  language: string | null;
}

interface Props {
  files: WsFile[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onCreate: (path: string) => void;
  onDelete: (id: string, path: string) => void;
}

export function FileExplorer({ files, activePath, onSelect, onCreate, onDelete }: Props) {
  const [newPath, setNewPath] = useState("");
  const [adding, setAdding] = useState(false);

  const submit = () => {
    if (!newPath.trim()) return;
    onCreate(newPath.trim());
    setNewPath("");
    setAdding(false);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-border flex items-center justify-between">
        <div className="font-mono text-xs text-primary flex items-center gap-1">
          <Folder className="h-3 w-3" /> files
        </div>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setAdding((v) => !v)}>
          <Plus className="h-3 w-3" />
        </Button>
      </div>
      {adding && (
        <div className="p-2 border-b border-border flex gap-1">
          <Input
            autoFocus
            placeholder="src/foo.ts"
            className="h-7 font-mono text-xs"
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") setAdding(false);
            }}
          />
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {files.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground font-mono">// no files. click + to create.</div>
        ) : (
          files.map((f) => (
            <div
              key={f.id}
              className={`group flex items-center justify-between px-2 py-1.5 cursor-pointer text-xs font-mono border-l-2 ${
                activePath === f.path ? "bg-accent border-primary text-primary" : "border-transparent hover:bg-accent/50"
              }`}
              onClick={() => onSelect(f.path)}
            >
              <div className="flex items-center gap-1.5 truncate">
                <FileCode className="h-3 w-3 shrink-0" />
                <span className="truncate">{f.path}</span>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    onClick={(e) => e.stopPropagation()}
                    className="opacity-0 group-hover:opacity-100 text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent className="bg-card border-border">
                  <AlertDialogHeader>
                    <AlertDialogTitle className="font-mono">delete {f.path}?</AlertDialogTitle>
                    <AlertDialogDescription>This is a destructive action. This file will be removed from the workspace.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="font-mono">cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="font-mono bg-destructive"
                      onClick={() => onDelete(f.id, f.path)}
                    >
                      delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
