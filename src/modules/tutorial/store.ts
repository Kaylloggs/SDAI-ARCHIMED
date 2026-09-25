import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Tutoriel ouvert, étape en cours de chacun, tutoriels terminés. Confort local uniquement. */
type TutorialState = {
  topic: string;
  steps: Record<string, number>;
  done: Record<string, true>;
  select: (topic: string) => void;
  setStep: (topic: string, step: number) => void;
  finish: (topic: string) => void;
  restart: (topic: string) => void;
};

export const START_TOPIC = "start";
export const CREATE_MODULE_TOPIC = "create-module";

export const useTutorialStore = create<TutorialState>()(
  persist(
    (set) => ({
      topic: START_TOPIC,
      steps: {},
      done: {},
      select: (topic) => set({ topic }),
      setStep: (topic, step) => set((s) => ({ steps: { ...s.steps, [topic]: step } })),
      finish: (topic) => set((s) => ({ done: { ...s.done, [topic]: true } })),
      restart: (topic) => set((s) => ({ steps: { ...s.steps, [topic]: 0 } })),
    }),
    { name: "archimed.tutorial" },
  ),
);
