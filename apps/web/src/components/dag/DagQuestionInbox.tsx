import type { DagGraph, DagQuestion } from "@t3tools/contracts";
import { ChevronDownIcon, MessageCircleQuestionIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import type { DagDispatch } from "./useDagDispatch";

function QuestionRow({
  question,
  nodeTitle,
  dispatch,
}: {
  question: DagQuestion;
  nodeTitle: string;
  dispatch: DagDispatch;
}) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const answer = async (value: string | null) => {
    setPending(true);
    const ok = await dispatch({
      type: "dag.question.answer",
      dagId: question.dagId,
      questionId: question.questionId,
      answer: value,
    });
    if (!ok) setPending(false);
  };
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{nodeTitle}</p>
      <p className="text-sm whitespace-pre-wrap">{question.prompt}</p>
      {question.options.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {question.options.map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => void answer(option)}
            >
              {option}
            </Button>
          ))}
        </div>
      ) : null}
      <form
        className="flex items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = text.trim();
          if (trimmed.length === 0) return;
          void answer(trimmed);
        }}
      >
        <Input
          size="sm"
          value={text}
          disabled={pending}
          placeholder="Type an answer"
          onChange={(event) => setText(event.target.value)}
        />
        <Button type="submit" size="sm" disabled={pending || text.trim().length === 0}>
          Answer
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => void answer(null)}
        >
          Dismiss
        </Button>
      </form>
    </li>
  );
}

/** Open questions across the DAG. Renders nothing when there are none. */
export function DagQuestionInbox({ graph, dispatch }: { graph: DagGraph; dispatch: DagDispatch }) {
  const [collapsed, setCollapsed] = useState(false);
  const open = useMemo(
    () => graph.questions.filter((question) => question.status === "open"),
    [graph.questions],
  );
  const nodeTitle = useMemo(
    () => new Map(graph.nodes.map((node) => [node.nodeId, node.title] as const)),
    [graph.nodes],
  );
  if (open.length === 0) return null;
  return (
    <section className="shrink-0 border-t border-border bg-background">
      <button
        type="button"
        className="flex h-9 w-full items-center gap-2 px-3 text-left text-sm font-medium"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((value) => !value)}
      >
        <MessageCircleQuestionIcon className="size-4 text-destructive-foreground" />
        {open.length} open question{open.length === 1 ? "" : "s"}
        <ChevronDownIcon
          className={cn("ml-auto size-4 text-muted-foreground", collapsed && "-rotate-90")}
        />
      </button>
      {collapsed ? null : (
        <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto px-3 pb-3">
          {open.map((question) => (
            <QuestionRow
              key={question.questionId}
              question={question}
              nodeTitle={nodeTitle.get(question.nodeId) ?? question.nodeId}
              dispatch={dispatch}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
