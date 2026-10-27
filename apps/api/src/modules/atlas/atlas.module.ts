import { Module } from '@nestjs/common';
import { ContentModule } from '../content/content.module';
import { FilesModule } from '../files/files.module';
import { GamificationModule } from '../gamification/gamification.module';
import { AtlasQuizService } from './atlas-quiz.service';
import { PublicAtlasController, StudentAtlasController, TeacherAtlasController } from './atlas.controller';
import { AtlasService } from './atlas.service';

/**
 * Модуль «atlas»: базовый предмет со своим интерфейсом «Mendeleev Atlas» (docs/CHEM_TZ_2.md) — данные экранов,
 * квиз «Проверь знания» и игра «Кто этот учёный?» с XP (BR-XP-05), предпросмотр учителя.
 */
@Module({
  imports: [ContentModule, FilesModule, GamificationModule],
  controllers: [StudentAtlasController, PublicAtlasController, TeacherAtlasController],
  providers: [AtlasService, AtlasQuizService],
})
export class AtlasModule {}
