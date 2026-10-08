import { createProject, addPiece, addTaggedExample, saveLook } from './domain.ts';
import type { Category, Tags, Project } from './types.ts';

/** Original, explicitly requested sample labels; never merged into a profile. */
export function createDemoProject(): Project {
  let project = createProject('Sample — Quiet lines & playful weekends');
  const pieces: [string, Category, Tags][] = [
    ['Chalk pocket shirt', 'top', { palette: 'neutral', fit: 'regular', style: 'minimal', formality: 'smart' }],
    ['Apricot weekend knit', 'top', { palette: 'warm', fit: 'relaxed', style: 'playful', formality: 'casual' }],
    ['Ink straight trousers', 'bottom', { palette: 'neutral', fit: 'regular', style: 'classic', formality: 'smart' }],
    ['Lagoon easy shorts', 'bottom', { palette: 'cool', fit: 'relaxed', style: 'sporty', formality: 'casual' }],
    ['Stone low shoes', 'shoes', { palette: 'neutral', fit: 'regular', style: 'minimal', formality: 'smart' }],
    ['Poppy court sneakers', 'shoes', { palette: 'bright', fit: 'regular', style: 'playful', formality: 'casual' }],
  ];
  for (const [name, category, tags] of pieces) project = addPiece(project, { name, category, tags, photoId: null });
  const liked: Tags[] = [
    { palette: 'neutral', fit: 'regular', style: 'minimal', formality: 'smart' },
    { palette: 'neutral', fit: 'relaxed', style: 'classic', formality: 'casual' },
    { palette: 'cool', fit: 'regular', style: 'minimal', formality: 'smart' },
    { palette: 'warm', fit: 'regular', style: 'classic', formality: 'smart' },
    { palette: 'neutral', fit: 'regular', style: 'classic', formality: 'formal' },
    { palette: 'cool', fit: 'relaxed', style: 'minimal', formality: 'casual' },
  ];
  const passed: Tags[] = [
    { palette: 'bright', fit: 'fitted', style: 'playful', formality: 'casual' },
    { palette: 'warm', fit: 'fitted', style: 'sporty', formality: 'casual' },
    { palette: 'bright', fit: 'relaxed', style: 'sporty', formality: 'smart' },
    { palette: 'cool', fit: 'fitted', style: 'playful', formality: 'formal' },
    { palette: 'warm', fit: 'relaxed', style: 'playful', formality: 'casual' },
    { palette: 'bright', fit: 'regular', style: 'sporty', formality: 'casual' },
  ];
  for (const [label, examples] of [['like', liked], ['pass', passed]] as const) {
    for (let i = 0; i < examples.length; i++) project = addTaggedExample(project, {
      caption: `Sample ${label === 'like' ? 'Like' : 'Pass'} ${i + 1} — illustrative labels, not your preferences`,
      label, tags: examples[i], photoId: null,
    });
  }
  return saveLook(project, [project.pieces[0].id, project.pieces[2].id, project.pieces[4].id],
    'Sample — An unhurried afternoon', 'An original procedural sample board. Replace these sample labels with your own examples.');
}
