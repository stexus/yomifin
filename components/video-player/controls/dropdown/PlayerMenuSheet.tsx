import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
} from "@gorhom/bottom-sheet";
import {
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  BackHandler,
  TouchableOpacity,
  useWindowDimensions,
} from "react-native";
import {
  BottomSheetContent,
  type OptionGroup,
} from "@/components/PlatformDropdown";
import { SHEET_MAX_HEIGHT_RATIO } from "@/constants/Values";

/** Player menus need dismissal events to suspend the control timeout reliably. */
export const PlayerMenuSheet = memo(function PlayerMenuSheet({
  title,
  groups,
  trigger,
  onOpenChange,
}: {
  title: string;
  groups: OptionGroup[];
  trigger: ReactNode;
  onOpenChange: (open: boolean) => void;
}) {
  const modal = useRef<BottomSheetModal>(null);
  const [isOpen, setIsOpen] = useState(false);
  const { height } = useWindowDimensions();
  const open = useCallback(() => {
    setIsOpen(true);
    onOpenChange(true);
    modal.current?.present();
  }, [onOpenChange]);
  const dismiss = useCallback(() => modal.current?.dismiss(), []);
  const onDismiss = useCallback(() => {
    setIsOpen(false);
    onOpenChange(false);
  }, [onOpenChange]);
  useEffect(() => {
    if (!isOpen) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        dismiss();
        return true;
      },
    );
    return () => subscription.remove();
  }, [isOpen, dismiss]);
  const backdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
      />
    ),
    [],
  );
  return (
    <>
      <TouchableOpacity
        accessibilityRole='button'
        accessibilityLabel={title}
        onPress={open}
      >
        {trigger}
      </TouchableOpacity>
      <BottomSheetModal
        ref={modal}
        enableDynamicSizing
        maxDynamicContentSize={height * SHEET_MAX_HEIGHT_RATIO}
        enablePanDownToClose
        stackBehavior='push'
        onDismiss={onDismiss}
        backdropComponent={backdrop}
        backgroundStyle={{ backgroundColor: "#171717" }}
        handleIndicatorStyle={{ backgroundColor: "white" }}
      >
        <BottomSheetContent title={title} groups={groups} onClose={dismiss} />
      </BottomSheetModal>
    </>
  );
});
