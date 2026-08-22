# Organizing threads

Pin a thread from its context menu to keep it in the pinned section above your active work.
Pinned threads are shown independently of their project, including when you connect to more than
one environment.

On web and desktop, drag a pinned thread to change its position. On mobile, open the thread's menu
and choose **Move up** or **Move down**. The order is stored by the server and appears on your
other connected devices.

If reordering is unavailable for one environment, update the trellis server running in that
environment. Older servers can still pin and unpin threads, but do not understand synced ordering;
their pinned threads keep the default newest-first order below the ones you have arranged.

## Sorting the thread list

The sort button beside the project filter controls the order of your active threads. Sort by
**Created**, which holds every thread in the slot it opened in, or by **Last activity**, which
follows the work as messages and turns land. Either one can run **Newest first** or **Oldest
first**.

The choice is stored on this device and applies to the active list only. Pinned threads keep the
order you arranged, snoozed threads stay ordered by when they wake, and finished threads stay
ordered by when their work ended.

## Environment artwork

Dev and Nightly environments can identify themselves with artwork at the top of the sidebar and in
the send button. Choose **Artwork**, **Version pill**, or **None** in Settings under environment
identification. Artwork is recolored to match each built-in theme. Custom themes use the **Version
pill** fallback because their colors are not controlled by trellis.

To generate a fresh title from the conversation, open a thread's context menu and choose
**Regenerate title**. While trellis is generating it, the action reads **Regenerating…** and cannot
be selected again. The option is hidden when the connected environment needs a server update.
