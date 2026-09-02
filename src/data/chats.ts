export type ChatType = 'partner' | 'trainer' | 'gym';

export interface Chat {
  id: string;
  name: string;
  type: ChatType;
  verified?: boolean;
  online?: boolean;
  last: string;
  time: string;
  unread?: boolean;
  faded?: boolean;
}

export interface ChatRequest {
  id: string;
  name: string;
  message: string;
  emptyProfile?: boolean;
}

export interface Message {
  id: string;
  fromMe: boolean;
  text: string;
  time: string;
}

/** Empty on purpose.
 *
 *  This held four invented conversations — complete with "online" dots, unread
 *  badges and message previews from people who do not exist. `useChats()` uses
 *  it as its fallback, so on any device without server chats the user was shown
 *  a mailbox full of strangers who had supposedly written to them. */
export const chats: Chat[] = [];

/** Empty on purpose — these were three invented people asking to train with
 *  you («Salam, eyni saatda gəlirik. Birlikdə məşq edək?»). A request must come
 *  from a real match_requests row or not exist at all. */
export const chatRequests: ChatRequest[] = [];

/** Empty on purpose — and this one mattered most.
 *
 *  `useMessages()` used it as the fallback for ANY thread the server had no
 *  messages for, so opening an empty conversation showed lines attributed to
 *  the other person that they never wrote. SPOT never writes a message and puts
 *  someone else's name on it — the same rule already enforced in src/store/db.ts
 *  for match acceptance and workout invitations. */
export const sampleThread: Message[] = [];

export const getChat = (id: string) => chats.find((c) => c.id === id);
