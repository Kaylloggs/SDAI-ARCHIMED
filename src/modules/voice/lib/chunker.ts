/**
 * Découpe une réponse qui arrive mot à mot en phrases prêtes à être dites : la voix
 * commence dès la première phrase stable, sans attendre la fin de la réponse.
 */
export class SentenceChunker {
  private buffer = "";
  private inCode = false;

  constructor(
    /** Longueur minimale d'un morceau (évite « Ok. » isolé, sauf en fin de réponse). */
    private readonly min = 24,
    /** Au-delà, on coupe à la virgule la plus proche pour ne pas faire attendre. */
    private readonly max = 220,
  ) {}

  /** Ajoute du texte ; renvoie les phrases complètes. */
  push(delta: string): string[] {
    this.buffer += delta;
    const out: string[] = [];
    for (;;) {
      const cut = this.findCut();
      if (cut < 0) break;
      const piece = this.buffer.slice(0, cut).trim();
      this.buffer = this.buffer.slice(cut);
      if (piece) out.push(piece);
    }
    return out;
  }

  /** Fin de la réponse : le reste part tel quel. */
  flush(): string[] {
    const rest = this.buffer.trim();
    this.buffer = "";
    this.inCode = false;
    return rest ? [rest] : [];
  }

  private findCut(): number {
    const text = this.buffer;
    // Un bloc de code ouvert : on attend qu'il se referme (il ne sera pas lu).
    const fences = text.match(/```/g)?.length ?? 0;
    this.inCode = fences % 2 === 1;
    if (this.inCode) return -1;
    const re = /([.!?…]+["»)]?)(\s+)|(\n\s*\n)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      const end = match.index + match[0].length;
      const candidate = text.slice(0, end).trim();
      // « M. », « 3.5 », « etc. » au milieu d'une phrase : pas une fin.
      if (/\b(M|Mme|Dr|etc|ex|cf|p|n°)\.$/i.test(candidate)) continue;
      if (candidate.length >= this.min) return end;
    }
    if (text.length > this.max) {
      const comma = text.lastIndexOf(", ", this.max);
      if (comma > this.min) return comma + 2;
      const space = text.lastIndexOf(" ", this.max);
      if (space > this.min) return space + 1;
    }
    return -1;
  }
}
