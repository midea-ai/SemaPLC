PROGRAM counter_program
VAR
    (* Input variables *)
    start_button AT %IX0.0 : BOOL := FALSE;
    reset_button AT %IX0.1 : BOOL := FALSE;
    
    (* Output variables *)
    counter_value AT %QW0 : INT := 0;
    running_led AT %QX0.0 : BOOL := FALSE;
    
    (* Internal variables *)
    counter : INT := 0;
    running : BOOL := FALSE;
    last_start : BOOL := FALSE;
    last_reset : BOOL := FALSE;
END_VAR

(* Rising edge detection for start button *)
IF start_button AND NOT last_start THEN
    running := NOT running;
END_IF
last_start := start_button;

(* Rising edge detection for reset button *)
IF reset_button AND NOT last_reset THEN
    counter := 0;
    running := FALSE;
END_IF
last_reset := reset_button;

(* Counter logic *)
IF running THEN
    counter := counter + 1;
    IF counter > 9999 THEN
        counter := 0;
    END_IF
END_IF

(* Output assignments *)
counter_value := counter;
running_led := running;

END_PROGRAM

CONFIGURATION Config0
RESOURCE Res0 ON PLC
    TASK task0(INTERVAL := TIME#100ms, PRIORITY := 0);
    PROGRAM instance0 WITH task0 : counter_program;
END_RESOURCE
END_CONFIGURATION