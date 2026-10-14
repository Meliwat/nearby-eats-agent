import { z } from "zod";
import { castVote, getPollView } from "@/agent/polls";
import { getOrCreateUserId } from "@/lib/session";

const voteRequest = z.strictObject({
  restaurantId: z.number().int(),
  name: z.string().trim().min(1).max(40),
  note: z.string().trim().max(200).nullable(),
});

/** Public by design: anyone with the (unguessable) link can see the poll. No chat content is exposed. */
export async function GET(_request: Request, { params }: RouteContext<"/api/polls/[pollId]">) {
  const { pollId } = await params;
  if (!z.uuid().safeParse(pollId).success) return Response.json({ error: "Poll not found" }, { status: 404 });
  const view = await getPollView(pollId, await getOrCreateUserId());
  return view ? Response.json(view) : Response.json({ error: "Poll not found" }, { status: 404 });
}

export async function POST(request: Request, { params }: RouteContext<"/api/polls/[pollId]">) {
  const { pollId } = await params;
  const body = voteRequest.safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(pollId).success || !body.success) {
    return Response.json({ error: body.success ? "Poll not found" : z.prettifyError(body.error) }, { status: 400 });
  }

  const voterId = await getOrCreateUserId();
  const view = await getPollView(pollId, voterId);
  if (!view) return Response.json({ error: "Poll not found" }, { status: 404 });
  if (!view.options.some((option) => option.restaurantId === body.data.restaurantId)) {
    return Response.json({ error: "That place isn't in this poll" }, { status: 400 });
  }

  await castVote({ pollId, voterId, restaurantId: body.data.restaurantId, voterName: body.data.name, note: body.data.note || null });
  return Response.json(await getPollView(pollId, voterId));
}
