import { Command } from 'commander';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getProjectRoot } from '@endorhq/rover-core';

export const initRoverCommand = new Command('init-rover')
  .description('Initialize .rover/ directory structure for V2 architecture')
  .action(async () => {
    try {
      const projectRoot = await getProjectRoot();
      const roverDir = path.join(projectRoot, '.rover');

      if (existsSync(roverDir)) {
        console.log(`Directory ${roverDir} already exists.`);
        return;
      }

      console.log(`Initializing .rover/ directory in ${projectRoot}...`);

      // Create directories
      mkdirSync(roverDir, { recursive: true });
      mkdirSync(path.join(roverDir, 'sessions'), { recursive: true });
      mkdirSync(path.join(roverDir, 'memories'), { recursive: true });
      mkdirSync(path.join(roverDir, 'memories', 'global'), { recursive: true });
      mkdirSync(path.join(roverDir, 'memories', 'tasks'), { recursive: true });

      // Create .gitignore
      writeFileSync(
        path.join(roverDir, '.gitignore'),
        `# Ignore temporary session files
sessions/*.tmp
`
      );

      // Create manifest.json
      const manifest = {
        version: '2.0.0',
        project: {
          name: path.basename(projectRoot),
          createdAt: new Date().toISOString(),
        },
        director: {
          model: 'claude-3-5-sonnet-20241022',
          checkIntervalSeconds: 30,
        },
        pipeline: {
          phases: ['planning', 'design', 'implement', 'test', 'deploy'],
          autoAdvance: true,
        },
        budget: {
          maxTokens: 10000000,
          maxCostUSD: 500,
          warningAt: 0.5,
        },
      };
      writeFileSync(path.join(roverDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

      // Create wbs.json
      const wbs = {
        version: '2.0.0',
        updatedAt: new Date().toISOString(),
        modules: [],
      };
      writeFileSync(path.join(roverDir, 'wbs.json'), JSON.stringify(wbs, null, 2));

      console.log('Successfully initialized .rover/ directory structure.');
    } catch (error) {
      console.error('Failed to initialize .rover/ directory:', error);
      process.exit(1);
    }
  });
