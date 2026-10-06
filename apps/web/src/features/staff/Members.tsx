import type { StaffMember } from '@noqueue/contracts/staff'
import type { RefObject } from 'react'
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import ellipsis from '@/assets/member-actions/ellipsis.svg'
import pencil from '@/assets/member-actions/pencil.svg'
import key from '@/assets/member-actions/key.svg'
import prohibit from '@/assets/member-actions/prohibit.svg'
import type { MemberAction } from './MemberActionDrawer'
import { memberRoleLabels } from './member-model'
export function Members({
  name,
  members,
  busy,
  loading,
  actionOpen,
  onAction,
  onToggle,
  trigger,
}: {
  name: string
  members: StaffMember[]
  busy: boolean
  loading: boolean
  actionOpen: boolean
  onAction: (action: MemberAction, trigger: HTMLButtonElement) => void
  onToggle: (member: StaffMember) => void
  trigger: RefObject<HTMLElement | null>
}) {
  return (
    <Card className="gap-6 rounded-[14px] py-4">
      <CardHeader className="px-4">
        <CardTitle>Accesos · {name}</CardTitle>
        <CardDescription>
          El administrador no puede ser eliminado ni degradado desde esta
          pantalla. No se comparten contraseñas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 px-4">
        <Button
          disabled={busy || loading}
          onClick={(event) => onAction({ kind: 'create' }, event.currentTarget)}
        >
          Añadir usuario
        </Button>
        {loading && <p role="status">Cargando usuarios…</p>}
        <Table className="table-fixed sm:table-auto">
          <TableHeader>
            <TableRow>
              <TableHead>Persona</TableHead>
              <TableHead className="w-[38%] sm:w-auto">Rol</TableHead>
              <TableHead className="w-18 text-right sm:w-auto">
                Acciones
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => (
              <TableRow key={member.id}>
                <TableCell className="whitespace-normal [overflow-wrap:anywhere] sm:whitespace-nowrap sm:[overflow-wrap:normal]">
                  <p>{member.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {member.username}
                  </p>
                  {!member.active && (
                    <p className="text-xs text-muted-foreground">
                      Acceso revocado
                    </p>
                  )}
                </TableCell>
                <TableCell className="whitespace-normal sm:whitespace-nowrap">
                  <Badge
                    className="h-auto min-h-5 max-w-full whitespace-normal [overflow-wrap:anywhere] sm:h-5 sm:max-w-none sm:whitespace-nowrap sm:[overflow-wrap:normal]"
                    variant={member.role === 'owner' ? 'default' : 'secondary'}
                  >
                    {member.role === 'owner'
                      ? 'Administrador'
                      : memberRoleLabels[member.role]}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="outline"
                          size="icon"
                          className="size-10"
                          aria-label={`Acciones de ${member.name}`}
                          disabled={busy || loading}
                          onClick={(event) => {
                            trigger.current = event.currentTarget
                          }}
                        />
                      }
                    >
                      <img src={ellipsis} alt="" width={24} height={24} />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="w-56 rounded-[10px] p-1"
                      finalFocus={actionOpen ? false : undefined}
                    >
                      <DropdownMenuGroup>
                        <DropdownMenuLabel>Acciones</DropdownMenuLabel>
                        <DropdownMenuItem
                          className="h-9"
                          disabled={busy || !member.canEditDetails}
                          onClick={() => {
                            if (trigger.current)
                              onAction(
                                { kind: 'edit', member },
                                trigger.current as HTMLButtonElement,
                              )
                          }}
                        >
                          <img src={pencil} alt="" width={16} height={16} />
                          Editar usuario
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="h-9"
                        disabled={busy}
                        onClick={() => {
                          if (trigger.current)
                            onAction(
                              { kind: 'password', member },
                              trigger.current as HTMLButtonElement,
                            )
                        }}
                      >
                        <img src={key} alt="" width={16} height={16} />
                        Restablecer contraseña
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="h-9"
                        variant={member.active ? 'destructive' : 'default'}
                        disabled={busy || member.role === 'owner'}
                        onClick={() => onToggle(member)}
                      >
                        <img src={prohibit} alt="" width={16} height={16} />
                        {member.active ? 'Revocar acceso' : 'Restaurar acceso'}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
            {!loading && members.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-muted-foreground">
                  No hay usuarios.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
