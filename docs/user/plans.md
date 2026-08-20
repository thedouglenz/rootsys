# Plans

A plan is a graph of work: nodes are units of work an agent can finish in one focused
session, and arrows say which nodes must finish before others may start. Plans are
built up front (by you, by an agent, or both), then run mostly unattended while the
app hands each ready node to a coding agent and records the outcome.

Open **Plans** from the sidebar footer or the command palette (**Open plans**). Plans
live on a server, so each connected environment lists its own.

## Create a plan

Click **New plan**, pick the environment (if you have more than one) and the project
the work runs in, and give it a title. The default model is what nodes run with unless
a node picks its own.

- Add a **goal** and a planner agent thread starts immediately: it explores the
  repository, builds the graph, and summarizes it for you before marking the plan
  ready. You land in that thread; talk to it like any other agent.
- Leave the goal empty and you land on an empty canvas to build the plan yourself.

## Plan with an agent

On any plan, **Plan with agent** starts a planner thread for a goal you type. It fills the
open plan rather than creating a new one, so you can re-plan a draft or extend a plan
that already has nodes.

## Edit the canvas

Nodes are laid out automatically, top to bottom. Drag a node to rearrange it for the
session; **Reset layout** puts everything back.

- **Add node** creates a node and opens it in the side panel.
- Click a node to edit its title, description, acceptance criteria (how the executor
  proves it is done), whether it is parallel-safe, and how it executes.
- Drag from the bottom handle of one node to the top handle of another to add a
  dependency. Dependencies that would create a cycle are refused.
- Click an arrow and press Backspace, or use **Remove dependency**, to delete it. The
  side panel also lists a node's dependencies with remove and add controls.
- Double-click a node to open the agent thread running it; nodes that have not started
  yet stay put.

## Edit with a companion

**Companion** starts a chat that knows this plan. Ask it to split a node, reorder
work, tighten acceptance criteria, or answer a question, and it applies the change
directly to the graph. It does not run the work.

## Run

**Run** starts the plan. The app picks the next ready node, starts a thread for it with
the plan's default model (or the node's own), and records the result when the agent
reports done. Running and blocked nodes show on the canvas; the thread link in a node's
panel opens the agent doing the work.

Run is unavailable until the plan has at least one node, a project, and a model to run
with. **Pause** stops new nodes from starting; in-flight work finishes. **Resume**
continues.

## Threads that belong to a plan

Every thread a plan starts — the planner, a companion, and each node's executor —
knows which plan it belongs to:

- The thread header shows a **Plan ▸ …** chip naming the node (or _planner_ /
  _companion_). Click it to open the plan with that node selected. The command
  palette offers **Open this thread's plan** while such a thread is open.
- In the sidebar, linked threads carry a small plan glyph tinted by the node's
  status, and threads of one plan sit together under a collapsible **Plan: …** header
  with the plan's progress. Click the header title to open the plan; the chevron
  collapses or expands the group. Pinned threads stay in the pinned block.
- The right panel gains a **Plan** surface: the plan's nodes in dependency order with
  the current node highlighted, open questions at the top, and a **Canvas** toggle for
  the graph. It opens by itself the first time you visit a linked thread; close it or
  pick another surface and that choice sticks for the thread.

## Run log

**Run log**, under the canvas, lists what happened to the plan newest-first: status
changes, node edits, questions and answers, and who caused each one (you, an agent, or
the app). Rows that belong to a thread link to it. The log follows the plan live while
it is open.

## Answer questions

When an executing agent needs you, it asks a question and its node turns blocked. Open
questions collect in the inbox under the canvas: pick an option, type an answer, or
dismiss. Answering the last open question on a node lets it continue. Other nodes
keep running in the meantime.

## Retry, skip, and finish

A failed node stops the plan with a failed status. Open the node and choose **Retry**
to queue it again and continue the plan; or **Skip** it and downstream nodes treat it as
satisfied. **Mark done** records a node you finished by hand, and **Reopen** puts a
done or skipped node back in the queue.

Archived plans stay readable but cannot be edited or run; toggle **Archived** on the
Plans page to see them, and unarchive from the plan's menu. Deleting a plan removes
its nodes, dependencies, and questions; threads it started are kept.

## On mobile

The mobile app lists plans under **Settings → Plans**, one section per connected
environment, with progress and open-question counts. Open a plan to see its status,
Run, Pause, or Resume it, answer or dismiss open questions, and read the nodes in
dependency order; tap a node that has started to open the agent thread doing the work.
Building and editing the graph stays on web and desktop.
