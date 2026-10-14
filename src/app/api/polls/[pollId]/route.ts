import { z } from "zod";
import { castVote, getPollView } from "@/agent/polls";
import { clientIp, LIMITS, rejectCrossSite, tooManyRequests } from "@/lib/rate-limit";
import { consumeLimits } from "@/lib/rate-limit-store";
import { getOrCreateUserId, getUserId } from "@/lib/session";

const voteRequest = z.strictObject({
  restaurantId: z.number().int(),
  name: z.string().trim().min(1).max(40),
  note: z.string().trim().max(200).nullable(),
});

/** Public by design: anyone with the (unguessable) link can see the poll. No chat content is exposed. */
export async function GET(request: Request, { params }: RouteContext<"/api/polls/[pollId]">) {
  const reads = await consumeLimits([{ limit: LIMITS.readPerIp, key: clientIp(request) }]);
  if (!reads.allowed) return tooManyRequests(reads, "Slow down a little.");
  const { pollId } = await params;
  if (!z.uuid().safeParse(pollId).success) return Response.json({ error: "Poll not found" }, { status: 404 });
  // Viewing never creates a user; without a cookie there is simply no "your vote" to show.
  const view = await getPollView(pollId, await getUserId());
  return view ? Response.json(view) : Response.json({ error: "Poll not found" }, { status: 404 });
}

export async function POST(request: Request, { params }: RouteContext<"/api/polls/[pollId]">) {
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;
  const { pollId } = await params;
  if (!z.uuid().safeParse(pollId).success) return Response.json({ error: "Poll not found" }, { status: 404 });
  const body = voteRequest.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: z.prettifyError(body.error) }, { status: 400 });

  const ip = clientIp(request);
  const limited = await consumeLimits([
    { limit: LIMITS.votePerIp, key: ip },
    { limit: LIMITS.votesPerPollPerIp, key: `${pollId}:${ip}` },
  ]);
  if (!limited.allowed) return tooManyRequests(limited, "Too many votes from this network. Try again later.");

  const voterId = await getOrCreateUserId();
  const view = await getPollView(pollId, voterId);
  if (!view) return Response.json({ error: "Poll not found" }, { status: 404 });
  if (!view.options.some((option) => option.restaurantId === body.data.restaurantId)) {
    return Response.json({ error: "That place isn't in this poll" }, { status: 400 });
  }

  await castVote({ pollId, voterId, restaurantId: body.data.restaurantId, voterName: body.data.name, note: body.data.note || null });
  return Response.json(await getPollView(pollId, voterId));
}
