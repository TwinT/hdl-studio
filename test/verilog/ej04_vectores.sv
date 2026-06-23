/*

A continuación veremos cómo trabajar con vectores de bits. Esto es una forma
de trabajar con muchos bits en una misma señal (de entrada, salida o interna).
Para eso, tenemos que definir su tipo como logic [x:y]. Por convención se elige
"x" como el índice más alto, e "y" como 0.

Veamos un ejemplo: una señal definida como "logic [5:0] signal;" tiene 6 bits,
arrancando por el 5 y terminando en el 0. Podemos referenciar estos bits de forma
individual usando signal[5], signal[4], ..., signal[0]. Estas referencias se pueden
usar tanto en el lado izquierdo como en el derecho de un "assign izq = der;".

Podemos referirnos a un subconjunto contíguo de los bits indicando inicio y final.
Ej: para seleccionar los tres últimos bits de signal, podemos usar "signal[2:0]".

También podemos referirnos a todos los bits de una señal omitiendo los corchetes (es
decir, haciendo solo "signal").

Podemos usar las operaciones lógicas que ya vimos (~, ^, |, &) tanto en un único bit
como en varios a la vez. Mientras las operaciones binarias tengan la misma cantidad
de bits en el lado derecho como en el lado izquierdo, las operaciones se van a realizar
con éxito.

Veamos cómo se hace un multiplexor de 4 vías de longitud 6 bits. Primero definamos qué
significa esto:
- Al tener cuatro vías, hay cuatro entradas con los diferentes valores posibles del out
- Según el valor de sel, out tomará alguno de esos cuatro valores posibles
- Para representar cuál de las cuatro vías queremos seleccionar, van a hacer falta dos
  bits:
  sel=00 => a; sel=01 => b; sel=10 => c; sel=11 => d;
- Como tiene longitud de 6 bits, tanto las cuatro vías como la salida van a ser señales
  de 6 bits.
  
El código del multiplexor quedaría así:
*/
module multiplexor46(
  input logic [5:0] a, b, c, d,
  input logic [1:0] sel,
  output logic [5:0] out
);
  
  assign out = sel[1] ?
               (sel[0] ? d : c) :
               (sel[0] ? b : a);
  
endmodule

/*

Prueben simular el circuito y cargarle diferentes valores a cada entrada.
Nota: para cada entrada, usar el modo "bin" en vez de "hex" para poder
cargarle la entrada en bits.

Observen el circuito sintetizado. Noten cómo se representa el componente
que elije el i-ésimo bit de una entrada de varios bits.

*/

/*

Ejercicio: desarrollen un shifter a izquierda de un bit para entradas de 6
bits. Es decir, que los bits de entrada se van a mover una posición hacia la
izquierda. El bit más a la izquierda del valor de entrada se descarta. El
bit más a la derecha del resultado va a ser siempre 0. Ej:

1  1  0  0  1  1   se convierte en:
  /  /  /  /  /
 /  /  /  /  /
1  0  0  1  1  0

Sugerencia: el ejercicio se puede resolver usando solamente dos "assign".
Resolver usando el código a continuación y testear usando ej04_tb.sv:

module ej04(
  input logic [5:0] in,
  output logic [5:0] out);
  
  // COMPLETAR
  
endmodule
*/

