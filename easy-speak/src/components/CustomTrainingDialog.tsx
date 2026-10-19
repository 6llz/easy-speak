import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, Bookmark, FileText, Loader2, Plus, Trash2, Upload, X } from 'lucide-react';
import { validateSettings } from '../lib/core';
import type { Settings } from '../lib/core';
import {
  createTrainingDraft,
  deleteTraining,
  MAX_TRAININGS,
  readTrainings,
  saveTraining,
  TRAINING_LIMITS,
  validateTraining,
} from '../lib/customTraining';
import type { CustomTraining } from '../lib/customTraining';
import { languageName } from '../lib/languages';
import { readTrainingFile, TRAINING_FILE_ACCEPT } from '../lib/trainingImport';
import { Modal } from './Modal';

type CustomTrainingDialogProps = {
  settings: Settings;
  onStart: (training: CustomTraining) => void;
  onOpenSettings: () => void;
  onClose: () => void;
  notify: (message: string) => void;
  initialTraining?: CustomTraining;
};
type ImportedMaterial = { text: string; sourceName: string };

/** 开始和保存使用独立快照；表单不会把模型设置或凭据带入训练记录。 */
function trainingSnapshot(draft: CustomTraining): CustomTraining {
  return {
    id: draft.id,
    title: draft.title.trim() || '自定义训练',
    instructions: draft.instructions.trim(),
    material: draft.material.trim(),
    sourceName: draft.sourceName,
    createdAt: draft.createdAt,
    updatedAt: new Date().toISOString(),
  };
}

export function CustomTrainingDialog(props: CustomTrainingDialogProps) {
  return (
    <Modal
      title="这次，按你的想法练"
      description="描述你想练什么，也可以带上文章、简历、单词或图片。"
      onClose={props.onClose}
      className="training-modal"
    >
      <CustomTrainingForm {...props} />
    </Modal>
  );
}

/** 导入结果须手动采用；取消、替换和卸载均失效旧请求，保护正在编辑的材料。 */
export function CustomTrainingForm({
  settings,
  onStart,
  onOpenSettings,
  onClose,
  notify,
  initialTraining,
}: CustomTrainingDialogProps) {
  const [draft, setDraft] = useState<CustomTraining>(() =>
    initialTraining ? trainingSnapshot(initialTraining) : createTrainingDraft(),
  );
  const [saved, setSaved] = useState(readTrainings);
  const [error, setError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [pendingImport, setPendingImport] = useState<ImportedMaterial | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const importVersionRef = useRef(0);
  const formId = useId();
  const isBlocked = isImporting || pendingImport !== null;
  const isSaved = saved.some((entry) => entry.id === draft.id);
  const totalLength = draft.instructions.length + draft.material.length;

  useEffect(
    () => () => {
      importVersionRef.current += 1;
      controllerRef.current?.abort();
    },
    [],
  );

  const cancelImport = () => {
    importVersionRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setIsImporting(false);
    setPendingImport(null);
  };
  const updateDraft = (field: 'title' | 'instructions' | 'material', value: string) => {
    if (field === 'material') cancelImport();
    setDraft((previous) => ({
      ...previous,
      [field]: value,
      ...(field === 'material' ? { sourceName: '' } : {}),
    }));
    setError('');
  };
  const handleImport = async (file: File) => {
    cancelImport();
    const controller = new AbortController();
    controllerRef.current = controller;
    const version = importVersionRef.current;
    setError('');
    setIsImporting(true);
    try {
      const result = await readTrainingFile(file, controller.signal, settings);
      if (controller.signal.aborted || version !== importVersionRef.current) return;
      if (result.sourceName.length > TRAINING_LIMITS.sourceName) {
        throw new Error('文件名称太长，请简化文件名后重新选择。');
      }
      setPendingImport(result);
    } catch (importError: unknown) {
      if (controller.signal.aborted || version !== importVersionRef.current) return;
      setError(importError instanceof Error ? importError.message : '材料读取失败，请重新选择。');
    } finally {
      if (version === importVersionRef.current) {
        controllerRef.current = null;
        setIsImporting(false);
      }
    }
  };
  const handleStart = () => {
    if (isBlocked) return;
    const training = trainingSnapshot(draft);
    const validation = validateTraining(training);
    if (validation) {
      setError(validation);
      return;
    }
    if (validateSettings(settings)) {
      setError('先连接一个模型，就能按你的要求开始训练。草稿会留在这里。');
      onOpenSettings();
      return;
    }
    cancelImport();
    onStart(training);
  };
  const handleSave = () => {
    if (isBlocked) return;
    const training = trainingSnapshot(draft);
    const validation = validateTraining(training);
    if (validation) {
      setError(validation);
      return;
    }
    if (!saveTraining(training)) {
      setError(
        !isSaved && saved.length >= MAX_TRAININGS
          ? `最多保存 ${MAX_TRAININGS} 个训练，请先删除不再使用的模板。`
          : '浏览器未能保存训练，请检查存储空间后重试。当前草稿仍在。',
      );
      return;
    }
    setDraft(training);
    setSaved(readTrainings());
    setError('');
    notify(isSaved ? '训练模板已更新。' : '训练模板已保存在此浏览器。');
  };
  const handleChooseTemplate = (training: CustomTraining) => {
    cancelImport();
    setDraft(trainingSnapshot(training));
    setDeleteId(null);
    setError('');
  };
  const handleDelete = (id: string) => {
    if (!deleteTraining(id)) {
      setError('浏览器未能删除这个模板，请重试。');
      return;
    }
    setSaved(readTrainings());
    setDeleteId(null);
    setError('');
    notify('已删除模板，当前编辑内容仍可继续使用。');
  };

  return (
    <form
      className="training-form"
      onSubmit={(event) => {
        event.preventDefault();
        handleStart();
      }}
    >
      <div className="training-body">
        <div className="training-language" aria-label="当前训练语言">
          <span>{languageName(settings.supportLanguage)}</span>
          <span aria-hidden="true">↔</span>
          <strong>{languageName(settings.practiceLanguage)}</strong>
        </div>
        <label className="field-label" htmlFor={`${formId}-instructions`}>
          你想怎么练？
          <span>随你定义</span>
        </label>
        <textarea
          id={`${formId}-instructions`}
          className="training-instructions"
          value={draft.instructions}
          maxLength={TRAINING_LIMITS.instructions}
          rows={5}
          placeholder="例如：请当我的面试官，根据附件逐个提问，并追问我的回答。也可以陪我练点餐、聊一本书，或用这些单词编一段对话。"
          onChange={(event) => updateDraft('instructions', event.target.value)}
          aria-describedby={`${formId}-instructions-help`}
        />
        <p className="training-field-help" id={`${formId}-instructions-help`}>
          写下场景、角色、目标或提问方式。也可以只上传材料，让语伴围绕它和你聊。
          <span>{draft.instructions.length} / 3,000</span>
        </p>

        <section className="training-material" aria-label="训练材料">
          <div className="training-section-heading">
            <h3>
              <FileText size={17} /> 带上你的材料 <small>可选</small>
            </h3>
            <label className="button secondary training-upload">
              <Upload size={15} />
              {isImporting ? '选择其他文件' : '上传文件或图片'}
              <input
                type="file"
                accept={TRAINING_FILE_ACCEPT}
                aria-label="上传训练材料"
                aria-describedby={`${formId}-privacy`}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  if (file) void handleImport(file);
                }}
              />
            </label>
          </div>
          <p className="training-field-help">
            TXT / Markdown / CSV / PDF / DOCX · JPG / PNG / WebP · 每个文件不超过 8 MB
          </p>
          <label className="sr-only" htmlFor={`${formId}-material`}>
            补充材料文字
          </label>
          <textarea
            id={`${formId}-material`}
            value={draft.material}
            maxLength={TRAINING_LIMITS.material}
            rows={draft.material ? 7 : 3}
            placeholder="可以直接粘贴文章、简历、单词表，或添加你希望语伴参考的背景。"
            onChange={(event) => updateDraft('material', event.target.value)}
          />
          {(draft.material || isImporting || pendingImport) && (
            <div className="training-material-meta">
              <span>
                {draft.sourceName || `${draft.material.length.toLocaleString('en-US')} 字符`}
              </span>
              {draft.material && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => updateDraft('material', '')}
                >
                  <X size={14} /> 清空材料
                </button>
              )}
            </div>
          )}
          {isImporting && (
            <div className="training-import-status" role="status">
              <Loader2 size={17} className="spin" />
              <span>正在读取材料，图片理解可能需要一点时间…</span>
              <button type="button" className="text-button" onClick={cancelImport}>
                取消读取
              </button>
            </div>
          )}
          {pendingImport && (
            <div className="training-import-preview">
              <h4>确认导入材料</h4>
              <p>{pendingImport.sourceName} · 请检查内容，采用后会替换上方材料。</p>
              <label className="sr-only" htmlFor={`${formId}-preview`}>
                导入材料预览
              </label>
              <textarea
                id={`${formId}-preview`}
                rows={5}
                maxLength={TRAINING_LIMITS.material}
                value={pendingImport.text}
                onChange={(event) =>
                  setPendingImport({ ...pendingImport, text: event.target.value })
                }
              />
              <div className="training-preview-actions">
                <button type="button" className="button secondary" onClick={cancelImport}>
                  放弃导入
                </button>
                <button
                  type="button"
                  className="button primary"
                  disabled={!pendingImport.text.trim()}
                  onClick={() => {
                    setDraft((previous) => ({
                      ...previous,
                      material: pendingImport.text,
                      sourceName: pendingImport.sourceName,
                    }));
                    setPendingImport(null);
                    setError('');
                  }}
                >
                  使用这份材料
                </button>
              </div>
            </div>
          )}
          <p className="training-privacy" id={`${formId}-privacy`}>
            文档在本机读取；图片会发送给当前模型理解，需模型支持看图，并消耗模型额度。开始后训练内容会发送给当前模型。
          </p>
          <button
            type="button"
            className="text-button training-model-settings"
            onClick={() => {
              if (isImporting) cancelImport();
              onOpenSettings();
            }}
          >
            模型设置
            <ArrowRight size={13} />
          </button>
        </section>

        <details className="training-templates">
          <summary>
            <Bookmark size={16} /> 训练名称与我的模板{' '}
            <span>
              {saved.length} / {MAX_TRAININGS}
            </span>
          </summary>
          <div className="training-template-body">
            <label className="field-label" htmlFor={`${formId}-title`}>
              训练名称 <span>可选</span>
            </label>
            <input
              id={`${formId}-title`}
              value={draft.title}
              maxLength={TRAINING_LIMITS.title}
              placeholder="自定义训练"
              onChange={(event) => updateDraft('title', event.target.value)}
            />
            <p className="training-field-help">
              选择一个模板继续编辑，或保存本次内容，下次直接使用。
            </p>
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                cancelImport();
                setDraft(createTrainingDraft());
                setDeleteId(null);
                setError('');
              }}
            >
              <Plus size={15} /> 新建空白训练
            </button>
            {!saved.length && (
              <p className="training-empty">还没有保存的模板，写好后可点“保存模板”。</p>
            )}
            <ul className="training-template-list">
              {saved.map((training) => (
                <li key={training.id}>
                  <div className="training-template-row">
                    <button
                      type="button"
                      className="training-template-select"
                      aria-pressed={training.id === draft.id}
                      onClick={() => handleChooseTemplate(training)}
                    >
                      <strong>{training.title}</strong>
                      <span>
                        {training.instructions || training.sourceName || '围绕材料自由交流'}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`删除模板 ${training.title}`}
                      onClick={() => setDeleteId(training.id)}
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                  {deleteId === training.id && (
                    <div className="training-delete-confirm" role="alert">
                      <p>删除这个本地模板？已经生成的练习记录会保留。</p>
                      <div>
                        <button
                          type="button"
                          className="button secondary"
                          onClick={() => setDeleteId(null)}
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          className="button danger"
                          onClick={() => handleDelete(training.id)}
                        >
                          确认删除
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </details>
        <p
          className={`training-total ${totalLength > TRAINING_LIMITS.material ? 'over-limit' : ''}`}
        >
          训练内容共 {totalLength.toLocaleString('en-US')} / 24,000 字符
        </p>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <p className="training-field-help training-storage-note">
          仅点“保存模板”才将训练要求与材料保留到此浏览器，不保存原文件。开始后的对话文字会记入本地练习记录。
        </p>
      </div>
      <div className="modal-actions training-footer">
        <button
          type="button"
          className="button secondary"
          onClick={handleSave}
          disabled={isBlocked}
        >
          <Bookmark size={15} />
          {isSaved ? '更新模板' : '保存模板'}
        </button>
        <div>
          <button
            type="button"
            className="button secondary training-cancel"
            onClick={() => {
              cancelImport();
              onClose();
            }}
          >
            取消
          </button>
          <button type="submit" className="button primary" disabled={isBlocked}>
            开始训练 <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </form>
  );
}
