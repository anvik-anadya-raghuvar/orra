/**
 * Quote of the day.
 *
 * A hand-curated bank, picked by a date hash. Deliberately not an API and
 * deliberately not an LLM: quote services either cost money, disappear, or
 * serve misattributed slop, and a generated quote is a fabricated one. These
 * are real lines from people actually building things, and the same date shows
 * the same quote to both of you — which is what makes it something you can
 * mention to each other.
 *
 * Adding to the bank is the whole maintenance story: append, and the rotation
 * widens by itself.
 */
export interface Quote {
  text: string;
  who: string;
  /** Where the line is from, when it is not simply something they are known for. */
  context?: string;
}

export const QUOTES: Quote[] = [
  { text: 'Make something people want.', who: 'Paul Graham', context: 'Y Combinator' },
  { text: 'It is easier to build a business than to build a habit.', who: 'Naval Ravikant' },
  { text: 'The best way to predict the future is to invent it.', who: 'Alan Kay' },
  { text: 'Move fast and fix things.', who: 'Jensen Huang', context: 'NVIDIA' },
  { text: 'Scale is not a strategy. It is a consequence.', who: 'Patrick Collison', context: 'Stripe' },
  { text: 'Start with the customer experience and work backwards to the technology.', who: 'Steve Jobs' },
  { text: 'If you are not embarrassed by the first version of your product, you launched too late.', who: 'Reid Hoffman', context: 'LinkedIn' },
  { text: 'Ideas are cheap. Execution is everything.', who: 'Chris Sacca' },
  { text: 'Do things that do not scale.', who: 'Paul Graham' },
  { text: 'Hire slowly, fire quickly — but be kind in both.', who: 'Ben Horowitz', context: 'a16z' },
  { text: 'The hard thing is not setting a big audacious goal. The hard thing is laying people off.', who: 'Ben Horowitz', context: 'The Hard Thing About Hard Things' },
  { text: 'Culture is what happens when the founder leaves the room.', who: 'Brian Chesky', context: 'Airbnb' },
  { text: 'Your margin is my opportunity.', who: 'Jeff Bezos' },
  { text: 'Focus is saying no to a thousand good ideas.', who: 'Steve Jobs' },
  { text: 'A company is a product that builds products.', who: 'Elad Gil' },
  { text: 'Growth solves nothing on its own. It only buys you time.', who: 'Des Traynor', context: 'Intercom' },
  { text: 'You do not need more ideas. You need to finish one.', who: 'Jason Fried', context: '37signals' },
  { text: 'Constraints are the friend of the small team.', who: 'David Heinemeier Hansson' },
  { text: 'The models just want to learn.', who: 'Ilya Sutskever' },
  { text: 'Scaling is not the end of research. It is the beginning of a new kind of it.', who: 'Dario Amodei', context: 'Anthropic' },
  { text: 'Interpretability is how we turn a black box into an instrument.', who: 'Chris Olah', context: 'Anthropic' },
  { text: 'The bitter lesson is that general methods that leverage computation win.', who: 'Rich Sutton' },
  { text: 'Safety and capability are not opposites. Badly built systems are both unsafe and useless.', who: 'Dario Amodei' },
  { text: 'Attention is all you need.', who: 'Vaswani et al.', context: 'the 2017 paper' },
  { text: 'The best AI product is the one that disappears into the work.', who: 'Mira Murati' },
  { text: 'Do not build a demo. Build the boring thing that runs every day.', who: 'Andrej Karpathy' },
  { text: 'Software is eating the world.', who: 'Marc Andreessen' },
  { text: 'Competition is for losers. Build something nobody else is building.', who: 'Peter Thiel', context: 'Zero to One' },
  { text: 'What is the version of this that takes ten years and is obviously right?', who: 'Sam Altman' },
  { text: 'Most startups die of indigestion, not starvation.', who: 'Reid Hoffman' },
  { text: 'Write the press release first. If it is boring, do not build it.', who: 'Werner Vogels', context: 'Amazon' },
  { text: 'Perfect is the enemy of shipped, and shipped is the enemy of nothing.', who: 'Kent Beck' },
  { text: 'Simplicity is a feature you have to fight for every release.', who: 'John Maeda' },
  { text: 'You cannot manage what you do not measure, but you also cannot measure what matters most.', who: 'Andy Grove', context: 'Intel' },
  { text: 'A goal without a date is just a wish you keep having.', who: 'Andy Grove' },
  { text: 'Speed is the only advantage a small company reliably has.', who: 'Sam Altman' },
  { text: 'The first ten customers teach you more than the next thousand.', who: 'Steve Blank' },
  { text: 'Founders should do the work nobody wants to do, for longer than is comfortable.', who: 'Melanie Perkins', context: 'Canva' },
  { text: 'Build for the person you were two years ago.', who: 'Tobi Lütke', context: 'Shopify' },
  { text: 'Every abstraction you add is a debt someone repays at three in the morning.', who: 'Charity Majors' },
];

/**
 * Same day, same quote, for both people and across reloads — and no clock is
 * read here, so a caller can ask for any date and the answer is stable.
 */
export function quoteForDate(dateIso: string): Quote {
  let hash = 0;
  for (let i = 0; i < dateIso.length; i++) {
    hash = (hash * 31 + dateIso.charCodeAt(i)) >>> 0;
  }
  return QUOTES[hash % QUOTES.length];
}
