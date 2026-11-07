# PictoNet 2.7.1

## Estructurar responde al árbol

- Una región que contiene varias entidades va a su ancestro común más profundo ("torso+barriga" va a la persona); solo dos figuras de nivel superior la dejan sin asignar.
- Todo lo que el modelo deja fuera de los grupos (ruido propuesto, sin resolver, no mencionado) se absorbe en la región asignada que lo contiene. Nada se borra.
- Las llamadas de estructuración usan temperatura 0, para que corridas repetidas coincidan.

En el piloto de 10 casos de ICAP 50 V2 (`docs/eval/icap-pilot-10-results-D3-2026-10-31.json`) la geometría sin asignar baja de 12,4 % a 0,3 % y los nodos con geometría suben de 51 a 53 de 57; la fidelidad no cambia.

## Estructurar trazado en la lista de filas

- Con "Registrar modificaciones" activo, la revisión de la estructura aparece también en la lista de filas (antes solo en la vista enfocada, y Estructurar parecía no hacer nada).
- Un error ya no queda tapado por "Trazado listo".

## Estilos de la biblioteca desde el editor

- Una clase creada en el editor se guarda en la paleta de la biblioteca.
- Cada clase citada tiene "Editar" para cambiar o agregar propiedades; el cambio se ve de inmediato y queda en la biblioteca.
- Las clases que ningún pictograma usa se pueden quitar, una a una o con "Quitar sin uso"; también las de base. Una clase en uso no se puede borrar. "Restaurar defaults" devuelve el set base, y toda biblioteca nueva parte de él.
- La paleta y el editor de clases se muestran por encima de la barra de selección.
