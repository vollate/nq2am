import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { api } from "./api";
import type { TaskSummary } from "./types";

const ACTIVE_KEY = "nq2am.activeTask";

type TasksContextValue = {
  tasks: TaskSummary[];
  loading: boolean;
  error: string | null;
  activeKey: string | null;
  setActiveKey: (key: string | null) => void;
  refresh: () => Promise<void>;
};

const TasksContext = createContext<TasksContextValue | null>(null);

export function TasksProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeKey, setActiveKeyState] = useState<string | null>(() =>
    typeof localStorage !== "undefined" ? localStorage.getItem(ACTIVE_KEY) : null,
  );

  const setActiveKey = useCallback((key: string | null) => {
    setActiveKeyState(key);
    if (key) {
      localStorage.setItem(ACTIVE_KEY, key);
    } else {
      localStorage.removeItem(ACTIVE_KEY);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const list = await api.listTasks();
      setTasks(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <TasksContext.Provider
      value={{ tasks, loading, error, activeKey, setActiveKey, refresh }}
    >
      {children}
    </TasksContext.Provider>
  );
}

export function useTasks(): TasksContextValue {
  const ctx = useContext(TasksContext);
  if (!ctx) {
    throw new Error("useTasks must be used within a TasksProvider");
  }
  return ctx;
}
