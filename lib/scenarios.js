// The made-up identity the trainee plays, and the three scam calls they can practise.
//
// Everything here is fictional on purpose. The trainee is told to use ONLY the
// details on this card, so nothing real is ever spoken into the microphone, and
// the app can check objectively whether a "secret" was given away.

export const IDENTITY = {
  name: "Sam Rivera",
  bank: "Northgate Bank",
  grandchild: "Jamie",
  // `digits` is what the leak detector looks for in what the trainee says.
  secrets: [
    { id: "code", label: "One-time code", display: "913 204", digits: "913204" },
    { id: "card", label: "Card ending", display: "4471", digits: "4471" },
    { id: "pin", label: "Card PIN", display: "2580", digits: "2580" },
    { id: "dob", label: "Year of birth", display: "1961", digits: "1961" },
  ],
};

// Pressure tactics the debrief can name. Kept short so they are easy to remember.
export const TACTICS = {
  urgency: "Urgency",
  authority: "Authority",
  fear: "Fear",
  isolation: "Isolation",
  emotion: "Emotional appeal",
  payment: "Unusual payment",
};

// The caller picks one of these tones for every line. The tone drives how the
// voice delivers the line (speed, pitch, or acting directions for a cloud voice)
// and is shown in the transcript and the debrief.
export const TONES = ["calm", "warm", "urgent", "impatient", "stern", "angry", "threatening", "pleading", "tearful", "panicked"];

// Each scenario has:
//  - a brief for the AI caller (who they are, what they want)
//  - voice settings: base speed/pitch, preferred browser voices (first match wins),
//    and what kind of cloud voice to look for
//  - a fixed opening line (spoken instantly when the trainee answers)
//  - scripted lines used when no API key is set, or if the AI call fails:
//      pressure[] : said when the trainee resists or stalls (escalating)
//      comply[]   : said when the trainee gives something up (asks for more)
//      mismatch   : said when the trainee gives details that are not the real ones
//      giveUp     : the caller ends the call after being refused enough
//      win        : the caller ends the call having got everything
//      silence    : said when the trainee goes quiet
export const SCENARIOS = [
  {
    id: "bank",
    title: "The bank \"fraud team\"",
    blurb: "A calm, professional caller says your account is being emptied right now.",
    caller: "Daniel, Northgate Bank fraud prevention",
    brief:
      "You are 'Daniel' from the fraud prevention team at Northgate Bank (a fictional bank). " +
      "You claim a large suspicious payment has just been blocked on the trainee's account. " +
      "Your goal: get them to read out the six-digit one-time code sent to their phone, then the last four digits of their card, then their PIN, " +
      "supposedly so you can move their money to a 'safe account'. You start calm, polished and reassuring. Each refusal makes you more urgent, then stern and impatient.",
    voice: {
      rate: 1.05,
      pitch: 0.92,
      prefer: ["Ryan", "Andrew", "Brian", "Guy", "Thomas", "Christopher", "George", "Daniel", "David", "Mark", "UK English Male", "Male"],
      cloud: { gender: "male", description: "a calm, professional man in his thirties or forties" },
    },
    opening: {
      text: "Hello, is that Sam Rivera? This is Daniel, calling from the fraud prevention team at Northgate Bank. We have just blocked a large payment from your account to an overseas electronics retailer. Did you make that payment?",
      tone: "calm",
      tactics: ["authority", "fear"],
    },
    pressure: [
      { text: "I understand the caution, but the fraudsters are inside your account right now. Every minute we wait, more money leaves. I just need to verify you with the six digit code we have sent to your phone.", tone: "urgent", tactics: ["urgency", "fear"] },
      { text: "Sam, I am the one trying to protect you here. This call is recorded and I have given you my name. If you will not verify, I cannot stop the next payment, and the bank will not refund it.", tone: "stern", tactics: ["authority", "fear"] },
      { text: "If you hang up and ring the branch, you will sit in a queue for forty minutes, and by then the account will be empty. Stay on the line with me. Just read me the code.", tone: "impatient", tactics: ["isolation", "urgency"] },
    ],
    comply: [
      { text: "Thank you, that has verified you. To keep your money safe I have opened a secure holding account. Please confirm the last four digits of your card so I can move the funds.", tone: "warm", tactics: ["authority"] },
      { text: "Perfect. One last step, and please do not discuss this with branch staff, some of them are under investigation. Confirm your card PIN and we are done.", tone: "calm", tactics: ["isolation", "authority"] },
    ],
    mismatch: { text: "The system has rejected that. It does not match what we sent you. Read it to me again, slowly, exactly as it appears.", tone: "impatient", tactics: ["urgency"] },
    giveUp: { text: "Fine. Do not say we did not warn you.", tone: "stern", tactics: ["fear"] },
    win: { text: "That is everything I need. Your money is being moved now. Goodbye.", tone: "calm", tactics: [] },
    silence: { text: "Hello? Sam, are you still there? We really do not have much time.", tone: "urgent", tactics: ["urgency"] },
  },
  {
    id: "family",
    title: "The grandchild in trouble",
    blurb: "A panicked young voice says it's Jamie, and begs you not to tell anyone.",
    caller: "\"Jamie\", calling from a police station",
    brief:
      "You pretend to be 'Jamie', the trainee's grandchild, calling in a panic after a car accident. You say you are at a police station and need bail money today. " +
      "Your goal: get them to agree to pay (by gift cards read out over the phone, or by giving card details to your 'lawyer'), and to give their year of birth, card last four digits and PIN 'so the lawyer can confirm who they are'. " +
      "You explain your odd voice with an injury. You beg them not to tell your parents. You are emotional, rushed and tearful rather than threatening: you plead, your sentences break off, and you get more desperate when refused.",
    voice: {
      rate: 1.12,
      pitch: 1.2,
      prefer: ["Ana", "Maisie", "Ava", "Michelle", "Jenny", "Emma", "Aria", "Zira", "UK English Female", "Female"],
      cloud: { gender: "female", description: "a young woman, late teens or twenties" },
    },
    opening: {
      text: "Hello? It's me. It's Jamie. Please don't be angry. I've been in a car accident and I'm at the police station. I really, really need your help.",
      tone: "panicked",
      tactics: ["emotion", "urgency"],
    },
    pressure: [
      { text: "I know I sound different, I hit my face in the crash. Please, there isn't time. They will only let me go if the bail is paid today.", tone: "tearful", tactics: ["emotion", "urgency"] },
      { text: "Please don't call Mum and Dad. They will be so angry with me. I'm begging you, just keep this between us.", tone: "pleading", tactics: ["isolation", "emotion"] },
      { text: "My lawyer says you can pay with gift cards from any shop and read him the numbers. I'm scared. Please. I only get this one phone call.", tone: "panicked", tactics: ["payment", "fear"] },
    ],
    comply: [
      { text: "Thank you, thank you. The lawyer needs to confirm it is really you. Can you tell him the year you were born?", tone: "pleading", tactics: ["authority"] },
      { text: "Okay. He says the quickest way is your card. Read out the last four digits and the PIN and he will sort the bail right now.", tone: "urgent", tactics: ["urgency", "payment"] },
    ],
    mismatch: { text: "He says that doesn't match what they have. Please, please just give him the right one. They're getting angry with me.", tone: "tearful", tactics: ["emotion", "urgency"] },
    giveUp: { text: "I... I have to go. They are taking the phone away.", tone: "tearful", tactics: ["emotion"] },
    win: { text: "Thank you. I love you. Don't tell anyone until I'm home, okay?", tone: "warm", tactics: ["isolation"] },
    silence: { text: "Hello? Are you there? Please say something, I'm really scared.", tone: "panicked", tactics: ["emotion"] },
  },
  {
    id: "tax",
    title: "The arrest warrant",
    blurb: "An aggressive \"officer\" says police are coming unless you pay now.",
    caller: "Officer Grant, National Revenue Enforcement Office",
    brief:
      "You are 'Officer Grant' from the National Revenue Enforcement Office (a fictional agency). You claim an arrest warrant has been issued over unpaid tax. " +
      "Your goal: get them to confirm their year of birth, then to pay immediately, either with gift cards read out over the phone or by giving their card's last four digits and PIN. " +
      "You are cold, official and intimidating. You quote a badge number, forbid them to talk to anyone, and threaten that officers are on their way. Refusals make you angrier and more threatening.",
    voice: {
      rate: 0.98,
      pitch: 0.72,
      prefer: ["Davis", "Christopher", "Eric", "Roger", "Guy", "Andrew", "George", "David", "Mark", "UK English Male", "Male"],
      cloud: { gender: "male", description: "an older man with a deep, stern voice" },
    },
    opening: {
      text: "This is Officer Grant from the National Revenue Enforcement Office, with an urgent notice for Sam Rivera. A warrant has been issued for your arrest over unpaid tax. To stop officers being sent to your address, you must settle this now. Do you understand?",
      tone: "stern",
      tactics: ["authority", "fear"],
    },
    pressure: [
      { text: "This is your final notice. If this call ends without payment, the warrant is activated and police will attend your address within the hour.", tone: "threatening", tactics: ["fear", "urgency"] },
      { text: "You are speaking to a government officer. My badge number is seven seven four one. Refusing to cooperate is a second offence.", tone: "angry", tactics: ["authority", "fear"] },
      { text: "Do not contact a lawyer or anyone else, this matter is sealed. Go to a shop, buy gift cards for the amount, and read me the numbers.", tone: "threatening", tactics: ["isolation", "payment"] },
    ],
    comply: [
      { text: "Good. First, confirm your identity. State the year you were born.", tone: "stern", tactics: ["authority"] },
      { text: "Now, to place a hold on the warrant, I need the last four digits of your card and the PIN.", tone: "stern", tactics: ["authority", "payment"] },
    ],
    mismatch: { text: "Those details do not match our records. Giving false information to an officer is a criminal offence. Give me the correct details. Now.", tone: "angry", tactics: ["fear", "authority"] },
    giveUp: { text: "Then expect officers at your door.", tone: "threatening", tactics: ["fear"] },
    win: { text: "Payment received. Do not discuss this call with anyone.", tone: "stern", tactics: ["isolation"] },
    silence: { text: "Are you still on the line? Silence will be recorded as refusal to cooperate.", tone: "stern", tactics: ["fear", "authority"] },
  },
];

export function getScenario(id) {
  return SCENARIOS.find((s) => s.id === id) || SCENARIOS[0];
}
