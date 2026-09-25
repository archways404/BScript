import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AlertTriangle, GripVertical, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

// Sortable, editable list of pipeline steps. `steps` carry a client-side `uid` for dnd-kit.
// `knownScripts` (optional) flags steps whose script isn't on the default branch.
export function StepList({ steps, onChange, knownScripts }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function onDragEnd({ active, over }) {
    if (!over || active.id === over.id) return
    const from = steps.findIndex((s) => s.uid === active.id)
    const to = steps.findIndex((s) => s.uid === over.id)
    onChange(arrayMove(steps, from, to))
  }

  const update = (uid, patch) => onChange(steps.map((s) => (s.uid === uid ? { ...s, ...patch } : s)))
  const remove = (uid) => onChange(steps.filter((s) => s.uid !== uid))

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={steps.map((s) => s.uid)} strategy={verticalListSortingStrategy}>
        <ol className="grid gap-2">
          {steps.map((step, index) => (
            <StepRow
              key={step.uid}
              step={step}
              index={index}
              missing={knownScripts && !knownScripts.includes(step.scriptPath)}
              onUpdate={(patch) => update(step.uid, patch)}
              onRemove={() => remove(step.uid)}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  )
}

function StepRow({ step, index, missing, onUpdate, onRemove }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: step.uid,
  })

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'glass flex flex-wrap items-center gap-3 rounded-lg p-2 pr-3',
        isDragging && 'relative z-10 shadow-2xl ring-1 ring-ring/40',
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className="text-muted-foreground hover:text-foreground cursor-grab touch-none rounded p-1 active:cursor-grabbing"
        aria-label={`Reorder step ${index + 1}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <span className="bg-muted text-muted-foreground grid size-6 place-items-center rounded-md text-xs tabular-nums">
        {index + 1}
      </span>
      <div className="min-w-48 flex-1">
        <Input
          value={step.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          placeholder={step.scriptPath}
          className="h-8 border-transparent bg-transparent px-2 font-medium shadow-none dark:bg-transparent"
          aria-label="Step name"
        />
        <div className="text-muted-foreground flex items-center gap-1.5 px-2 font-mono text-xs">
          .BScript/{step.scriptPath}
          {missing && (
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertTriangle className="text-warning size-3.5" aria-label="Script not found" />
              </TooltipTrigger>
              <TooltipContent>Not found on the default branch</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
      <label className="text-muted-foreground flex items-center gap-2 text-xs" title="Keep going if this step fails">
        <Switch checked={step.continueOnError} onCheckedChange={(continueOnError) => onUpdate({ continueOnError })} />
        Allow failure
      </label>
      <label className="text-muted-foreground flex items-center gap-1.5 text-xs" title="Timeout in minutes">
        <Input
          type="number"
          min={1}
          max={1440}
          value={Math.round(step.timeoutSec / 60)}
          onChange={(e) => onUpdate({ timeoutSec: Math.max(1, Number(e.target.value) || 1) * 60 })}
          className="h-8 w-16 text-right tabular-nums"
          aria-label="Timeout in minutes"
        />
        min
      </label>
      <Button variant="ghost" size="icon" onClick={onRemove} aria-label={`Remove step ${index + 1}`}>
        <Trash2 />
      </Button>
    </li>
  )
}
